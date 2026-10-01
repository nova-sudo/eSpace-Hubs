/**
 * Per-user persisted cache for provider-derived SWR results
 * (`github:*`, `gitlab:*`, `gh_actions:*`, `jenkins:*`, `jira:*`,
 * `combined:*`), plus the in-memory freshness ledger the UI reads for
 * "updated 5 min ago".
 *
 * Why: SWR's default cache is an in-memory Map, so every reload painted
 * "—" and re-walked every paginated provider list. Persisting the last
 * good result per key lets tiles render last-known values immediately
 * and revalidate in the background (stale-while-revalidate), and lets
 * the app keep showing data while a provider is rate-limited.
 *
 * Storage: IndexedDB through a tiny wrapper, localStorage when IDB is
 * unavailable (Firefox private mode, blocked site data), memory as the
 * last resort (SSR, node tests). Every storage touch is in try/catch —
 * the cache is an optimisation and must never break a page.
 *
 * Privacy (CLAUDE.md rule 4, Settings privacy copy): the payloads are
 * the user's own PR / ticket / build metadata — never tokens. Records are
 * namespaced by user id, and the whole store is wiped on sign-out, on
 * sign-in and whenever the signed-in user changes (use-session calls
 * `clearProviderCache`, and `auth:user-storage-cleared` does too).
 *
 * Budget: entries over `maxEntryBytes` are not persisted; the total is
 * capped at `maxTotalBytes` with least-recently-used eviction; entries
 * older than `maxAgeMs` are dropped on load.
 *
 * Pure module — no React. The SWR wiring lives in
 * `features/integrations/cache/`.
 */

export const PROVIDER_KEY_RE = /^(gitlab|github|gh_actions|jenkins|jira|combined):/;

export const IDB_NAME = "espace-devhub-provider-cache";
const IDB_STORE = "entries";
export const LS_KEY = "espace-devhub:provider-cache";

const DAY_MS = 24 * 60 * 60_000;

export const DEFAULT_LIMITS = Object.freeze({
  idb: { maxTotalBytes: 8 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024 },
  localStorage: { maxTotalBytes: 1536 * 1024, maxEntryBytes: 512 * 1024 },
  memory: { maxTotalBytes: 8 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024 },
  maxAgeMs: 7 * DAY_MS,
});

/** True for SWR keys whose results come from a provider. */
export function isProviderKey(key) {
  return typeof key === "string" && PROVIDER_KEY_RE.test(key);
}

/**
 * The rate-limit provider(s) a key's fetch depends on. `gh_actions`
 * spends the GitHub budget; `combined` spans both code hosts.
 */
export function providersForKey(key) {
  if (!isProviderKey(key)) return [];
  const prefix = key.slice(0, key.indexOf(":"));
  if (prefix === "gh_actions") return ["github"];
  if (prefix === "combined") return ["github", "gitlab"];
  return [prefix];
}

/**
 * True when `value` survives a JSON round-trip unchanged in meaning:
 * plain objects, arrays, strings, finite numbers, booleans, null.
 * A Map / Set / Date / class instance would come back as something
 * else, so such a result is simply not persisted.
 */
export function isJsonSafe(value, depth = 0) {
  if (depth > 64) return false;
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return Number.isFinite(value);
  if (t !== "object") return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === undefined) continue; // JSON writes null; harmless for our lists
      if (!isJsonSafe(item, depth + 1)) return false;
    }
    return true;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  for (const k in value) {
    const v = value[k];
    if (v === undefined) continue;
    if (!isJsonSafe(v, depth + 1)) return false;
  }
  return true;
}

/* ───────────────────────── backends ───────────────────────── */
/*
 * Backend contract (all async, all non-throwing):
 *   kind: "idb" | "localStorage" | "memory"
 *   getAll()      → Promise<record[]>
 *   put(record)   → Promise<void>
 *   remove(ids[]) → Promise<void>
 *   clear()       → Promise<void>
 * record: { id, userId, key, json, fetchedAt, lastAccess, size }
 */

export function createMemoryBackend() {
  const rows = new Map();
  return {
    kind: "memory",
    async getAll() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
    async put(record) {
      rows.set(record.id, { ...record });
    },
    async remove(ids) {
      for (const id of ids) rows.delete(id);
    },
    async clear() {
      rows.clear();
    },
  };
}

/** localStorage backend: one JSON blob under LS_KEY. */
export function createLocalStorageBackend(storage) {
  const ls = () => {
    try {
      return storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    } catch {
      return null;
    }
  };
  const readAll = () => {
    try {
      const raw = ls()?.getItem(LS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed.entries === "object" && parsed.entries
        ? parsed.entries
        : {};
    } catch {
      return {};
    }
  };
  const writeAll = (entries) => {
    try {
      const store = ls();
      if (!store) return;
      if (Object.keys(entries).length === 0) store.removeItem(LS_KEY);
      else store.setItem(LS_KEY, JSON.stringify({ v: 1, entries }));
    } catch {
      /* quota / disabled storage — the cache is optional */
    }
  };
  return {
    kind: "localStorage",
    async getAll() {
      return Object.values(readAll());
    },
    async put(record) {
      const entries = readAll();
      entries[record.id] = record;
      writeAll(entries);
    },
    async remove(ids) {
      const entries = readAll();
      for (const id of ids) delete entries[id];
      writeAll(entries);
    },
    async clear() {
      try {
        ls()?.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * IndexedDB backend. `openDb` resolves to null when IDB is unusable, in
 * which case every call is a no-op (the factory below falls back first).
 */
export function createIdbBackend(idb) {
  let dbPromise = null;
  const open = () => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = idb.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          try {
            req.result.createObjectStore(IDB_STORE, { keyPath: "id" });
          } catch {
            /* already exists */
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  };
  const withStore = async (mode, fn) => {
    try {
      const db = await open();
      if (!db) return undefined;
      const tx = db.transaction(IDB_STORE, mode);
      const store = tx.objectStore(IDB_STORE);
      const out = await fn(store);
      if (mode === "readwrite") {
        await new Promise((resolve) => {
          tx.oncomplete = resolve;
          tx.onerror = resolve;
          tx.onabort = resolve;
        });
      }
      return out;
    } catch {
      return undefined;
    }
  };
  return {
    kind: "idb",
    ready: () => open().then(Boolean),
    async getAll() {
      return (await withStore("readonly", (s) => idbRequest(s.getAll()))) || [];
    },
    async put(record) {
      await withStore("readwrite", (s) => {
        s.put(record);
      });
    },
    async remove(ids) {
      await withStore("readwrite", (s) => {
        for (const id of ids) s.delete(id);
      });
    },
    async clear() {
      await withStore("readwrite", (s) => {
        s.clear();
      });
    },
  };
}

/**
 * Best available backend: IndexedDB, else localStorage, else memory.
 * IDB availability is only known after `open()`, so this returns a
 * delegating backend that settles on first use.
 */
export function createAutoBackend() {
  let chosen = null;
  const choose = async () => {
    if (chosen) return chosen;
    let idb = null;
    try {
      idb = typeof indexedDB !== "undefined" ? indexedDB : null;
    } catch {
      idb = null;
    }
    if (idb) {
      const candidate = createIdbBackend(idb);
      if (await candidate.ready()) {
        chosen = candidate;
        return chosen;
      }
    }
    let hasLs = false;
    try {
      hasLs = typeof window !== "undefined" && Boolean(window.localStorage);
    } catch {
      hasLs = false;
    }
    chosen = hasLs ? createLocalStorageBackend() : createMemoryBackend();
    return chosen;
  };
  const backend = {
    kind: "auto",
    resolveKind: async () => (await choose()).kind,
    async getAll() {
      return (await choose()).getAll();
    },
    async put(record) {
      return (await choose()).put(record);
    },
    async remove(ids) {
      return (await choose()).remove(ids);
    },
    async clear() {
      // Clear every backend we might have written to in an earlier
      // session (IDB may have been unavailable then), not just the
      // current one.
      const b = await choose();
      await b.clear();
      if (b.kind !== "localStorage") await createLocalStorageBackend().clear();
    },
  };
  return backend;
}

/* ───────────────────────── the cache ───────────────────────── */

const SEP = "\u0000";

/**
 * Create a cache instance over `backend`. Exported for tests; the app
 * uses the `providerCache` singleton below.
 */
export function createProviderCache({
  backend = createMemoryBackend(),
  maxTotalBytes,
  maxEntryBytes,
  maxAgeMs = DEFAULT_LIMITS.maxAgeMs,
  now = () => Date.now(),
} = {}) {
  let userId = null;
  /** Bumped on clear/user change so in-flight writes from before are dropped. */
  let generation = 0;
  /** id → { key, size, lastAccess, fetchedAt } for the current user. */
  const index = new Map();
  /** key → { fetchedAt, source: "persisted" | "network" } — current user. */
  const freshness = new Map();
  const listeners = new Set();
  /** Serialise backend writes so eviction sees a consistent total. */
  let queue = Promise.resolve();

  const limits = () => {
    const kind = backend.kind === "auto" ? "idb" : backend.kind;
    const d = DEFAULT_LIMITS[kind] || DEFAULT_LIMITS.memory;
    return {
      total: maxTotalBytes ?? d.maxTotalBytes,
      entry: maxEntryBytes ?? d.maxEntryBytes,
    };
  };

  const emit = (key) => {
    for (const fn of [...listeners]) {
      try {
        fn(key);
      } catch {
        /* ignore */
      }
    }
  };

  const enqueue = (fn) => {
    queue = queue.then(fn, fn).catch(() => {});
    return queue;
  };

  const idFor = (key) => `${userId}${SEP}${key}`;

  async function evictToFit(budget) {
    let total = 0;
    for (const e of index.values()) total += e.size;
    if (total <= budget) return;
    const byAge = [...index.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const drop = [];
    for (const [id, e] of byAge) {
      if (total <= budget) break;
      total -= e.size;
      drop.push(id);
      index.delete(id);
    }
    if (drop.length) await backend.remove(drop);
  }

  return {
    get userId() {
      return userId;
    },

    /**
     * Switch namespace and load that user's entries. Resolves to
     * `{ [key]: data }` suitable for SWR's `fallback`.
     */
    async load(nextUserId) {
      userId = nextUserId ? String(nextUserId) : null;
      generation += 1;
      const gen = generation;
      index.clear();
      freshness.clear();
      emit(null);
      if (!userId) return {};
      // Through the write queue, so a clear() issued just before (sign-out
      // → sign-in) has finished before we read.
      let rows = [];
      try {
        rows = (await enqueue(() => backend.getAll())) || [];
      } catch {
        rows = [];
      }
      if (gen !== generation) return {};
      const out = {};
      const stale = [];
      const t = now();
      for (const row of rows) {
        if (!row || row.userId !== userId) {
          // Another account's leftovers (a wipe that failed) — drop them.
          if (row?.id) stale.push(row.id);
          continue;
        }
        if (!isProviderKey(row.key) || t - (row.fetchedAt || 0) > maxAgeMs) {
          stale.push(row.id);
          continue;
        }
        try {
          out[row.key] = JSON.parse(row.json);
        } catch {
          stale.push(row.id);
          continue;
        }
        index.set(row.id, {
          key: row.key,
          size: row.size || row.json.length,
          lastAccess: row.lastAccess || row.fetchedAt || 0,
          fetchedAt: row.fetchedAt,
        });
        freshness.set(row.key, { fetchedAt: row.fetchedAt, source: "persisted" });
      }
      if (stale.length) enqueue(() => backend.remove(stale));
      emit(null);
      return out;
    },

    /** Persist a successful result. Returns the write promise (tests await it). */
    write(key, data, fetchedAt = now()) {
      if (!userId || !isProviderKey(key)) return Promise.resolve(false);
      freshness.set(key, { fetchedAt, source: "network" });
      emit(key);
      if (data === undefined || !isJsonSafe(data)) return Promise.resolve(false);
      let json;
      try {
        json = JSON.stringify(data);
      } catch {
        return Promise.resolve(false);
      }
      const gen = generation;
      const uid = userId;
      const id = idFor(key);
      const size = json.length * 2; // UTF-16 upper bound; good enough for a budget
      return enqueue(async () => {
        if (gen !== generation || uid !== userId) return false;
        const { total, entry } = limits();
        if (size > entry) {
          if (index.has(id)) {
            index.delete(id);
            await backend.remove([id]);
          }
          return false;
        }
        const t = now();
        index.set(id, { key, size, lastAccess: t, fetchedAt });
        await backend.put({ id, userId: uid, key, json, fetchedAt, lastAccess: t, size });
        if (gen !== generation) return false;
        await evictToFit(total);
        return index.has(id);
      });
    },

    /** Mark a key as used (LRU) without rewriting it. In-memory only. */
    touch(key) {
      const e = index.get(idFor(key));
      if (e) e.lastAccess = now();
    },

    /** Record a revalidation that confirmed the cached copy (304). */
    confirm(key, fetchedAt = now()) {
      if (!isProviderKey(key)) return;
      freshness.set(key, { fetchedAt, source: "network" });
      emit(key);
    },

    /** `{ fetchedAt, source }` for a key, or null. */
    freshness(key) {
      return freshness.get(key) ?? null;
    },

    /** Latest fetchedAt across keys that depend on `provider`. */
    latestFetchedAtFor(provider) {
      let best = null;
      for (const [key, f] of freshness) {
        if (!providersForKey(key).includes(provider)) continue;
        if (best === null || f.fetchedAt > best) best = f.fetchedAt;
      }
      return best;
    },

    /** Keys currently tracked (tests + debugging). */
    keys() {
      return [...index.values()].map((e) => e.key);
    },

    /** Wipe everything, every user. Called on sign-out / user change. */
    clear() {
      generation += 1;
      index.clear();
      freshness.clear();
      userId = null;
      emit(null);
      return enqueue(() => backend.clear());
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Resolves once queued writes/clears have settled (tests). */
    flush() {
      return queue;
    },
  };
}

/** The app-wide instance. */
export const providerCache = createProviderCache({ backend: createAutoBackend() });

/**
 * Wipe the persisted provider cache (every user). Wired into use-session's
 * logout / sign-in / user-change path.
 */
export function clearProviderCache() {
  try {
    return providerCache.clear();
  } catch {
    return Promise.resolve();
  }
}

// Belt and braces: every auth transition that wipes user-scoped storage
// also wipes this cache.
if (typeof window !== "undefined") {
  try {
    window.addEventListener("auth:user-storage-cleared", () => {
      void clearProviderCache();
    });
  } catch {
    /* ignore */
  }
}
