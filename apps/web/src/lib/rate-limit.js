/**
 * Client-side rate-limit handling, shared by the provider proxy fetcher
 * (`proxyFetch`) and the AI batch orchestrators (PR grading, goal
 * tier grading).
 *
 * The model is a per-provider CIRCUIT BREAKER, not a per-request retry
 * loop. The old loop slept up to 2 minutes, six times, per request — so a
 * GitHub primary limit (reset up to an hour away) meant ~10 minutes of
 * spinner on every tile, with every parallel key and N+1 worker running
 * its own loop and still sending requests.
 *
 * Now:
 *  - A limited response (primary: 429/403 with the remaining counter at
 *    0; secondary: GitHub's 403 with Retry-After or "secondary rate
 *    limit" in the body) records `{ until }` for that provider (and
 *    GitHub bucket — search and core are separate pools).
 *  - While a provider is limited, `fetchWithRateLimitRetry` does not
 *    send: it answers with a synthetic 429 immediately, so the caller
 *    fails fast and SWR keeps serving the cached data.
 *  - At most ONE retry, and only when the advertised wait is under 10s.
 *  - One event (`RATE_LIMIT_EVENT`) per state change feeds the single
 *    app-level banner. No toasts from here — a fan-out used to stack them.
 *
 * Pure module (no React). Every `window` touch is guarded so it runs in
 * node tests and during SSR.
 */

export const RATE_LIMIT_EVENT = "espace-devhub:rate-limit-wait";

/** Providers the banner knows how to name. */
export const RATE_LIMIT_PROVIDERS = Object.freeze([
  "github",
  "gitlab",
  "jira",
  "jenkins",
  "ai",
]);

/** A wait at or below this is retried once in place; anything longer fails fast. */
export const SHORT_RETRY_MAX_MS = 10_000;

/** Nothing advertised: GitHub's guidance is "wait at least one minute". */
const DEFAULT_LIMIT_WAIT_MS = 60_000;

/** Never trust a header that asks for more than this. */
const MAX_LIMIT_WAIT_MS = 60 * 60_000;

/** Kept for callers that still pass `maxAttempts`; 2 = one retry. */
export const DEFAULT_MAX_ATTEMPTS = 2;

const SECONDARY_BODY_RE = /secondary rate limit|abuse detection|rate limit exceeded/i;

function header(headers, name) {
  try {
    return headers?.get?.(name) ?? null;
  } catch {
    return null;
  }
}

function remainingOf(headers) {
  return header(headers, "x-ratelimit-remaining") ?? header(headers, "ratelimit-remaining");
}

function bodyRetryAfterMs(bodyText) {
  if (!bodyText) return null;
  try {
    const parsed = typeof bodyText === "string" ? JSON.parse(bodyText) : bodyText;
    const ms = Number(parsed?.error?.retryAfterMs);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

/** Epoch-seconds OR delta-seconds reset value → ms from `now`. */
function resetToMs(raw, now) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n > 1_000_000_000 ? n * 1000 - now : n * 1000;
}

/** IETF draft-7 combined header (our own API): `limit=10, remaining=0, reset=300`. */
function draft7ResetMs(headers) {
  const raw = header(headers, "ratelimit");
  if (!raw) return null;
  const m = /reset=(\d+)/i.exec(raw);
  return m ? Number(m[1]) * 1000 : null;
}

/**
 * How long the upstream asks us to wait (ms). Precedence: Retry-After
 * (seconds or HTTP date) → our API's `error.retryAfterMs` → reset headers
 * (either spelling, only when remaining is 0) → draft-7 `RateLimit` →
 * null when nothing is advertised.
 */
export function advertisedWaitMs(headers, bodyText, now = Date.now()) {
  const ra = header(headers, "retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const when = Date.parse(ra);
    if (Number.isFinite(when)) return Math.max(0, when - now);
  }
  const fromBody = bodyRetryAfterMs(bodyText);
  if (fromBody !== null) return fromBody;
  if (remainingOf(headers) === "0") {
    const reset = resetToMs(
      header(headers, "x-ratelimit-reset") ?? header(headers, "ratelimit-reset"),
      now,
    );
    if (reset !== null) return Math.max(0, reset);
  }
  const draft7 = draft7ResetMs(headers);
  if (draft7 !== null) return draft7;
  return null;
}

/**
 * Classify a response. Returns null when it is not a rate limit, else
 * `{ kind: "primary" | "secondary", waitMs, resource }`.
 *
 * - 429 → always a limit.
 * - 403 → a limit when the remaining counter is 0 (primary), or when
 *   Retry-After is present / the body names the secondary limit
 *   (GitHub secondary — the remaining counter is usually still positive).
 *   Any other 403 is a real auth failure.
 */
export function detectRateLimit(status, headers, bodyText = "", now = Date.now()) {
  if (status !== 429 && status !== 403) return null;
  const remaining = remainingOf(headers);
  const hasRetryAfter = Boolean(header(headers, "retry-after"));
  const secondaryBody = SECONDARY_BODY_RE.test(String(bodyText || "").slice(0, 4000));
  const primary = remaining === "0";
  if (status === 403 && !primary && !hasRetryAfter && !secondaryBody) return null;
  let kind = "primary";
  if (secondaryBody || (!primary && hasRetryAfter)) kind = "secondary";
  const advertised = advertisedWaitMs(headers, bodyText, now);
  const waitMs = Math.min(
    MAX_LIMIT_WAIT_MS,
    advertised === null ? DEFAULT_LIMIT_WAIT_MS : advertised,
  );
  const resource = header(headers, "x-ratelimit-resource");
  return { kind, waitMs, resource: resource ? resource.toLowerCase() : null };
}

/**
 * Back-compat: true when a response is a rate-limit rejection. Header-only
 * (no body), so a secondary-limit 403 without Retry-After reads false here;
 * `fetchWithRateLimitRetry` peeks the body and catches that case.
 */
export function isRateLimitStatus(status, headers) {
  if (status === 429) return true;
  if (status !== 403) return false;
  return remainingOf(headers) === "0" || Boolean(header(headers, "retry-after"));
}

/** Back-compat alias used by older callers: the wait, or a small backoff. */
export function rateLimitDelayMs(status, headers, body, attempt = 1) {
  const text = body && typeof body !== "string" ? JSON.stringify(body) : body;
  const advertised = advertisedWaitMs(headers, text);
  if (advertised !== null) return Math.min(advertised, MAX_LIMIT_WAIT_MS);
  return Math.min(2_000 * 2 ** (attempt - 1), 30_000);
}

/* ───────────────────────── shared state ───────────────────────── */

/**
 * `${provider}` (provider-wide) or `${provider}:${bucket}` → entry.
 * GitHub's search and core budgets are separate pools, so a search
 * exhaustion must not block core calls; a secondary limit is
 * provider-wide.
 */
const limits = new Map();
const listeners = new Set();
const expiryTimers = new Map();
let version = 0;
let snapshot = Object.freeze({ version: 0, byProvider: Object.freeze({}) });

function stateKey(provider, bucket) {
  return bucket ? `${provider}:${bucket}` : provider;
}

function rebuildSnapshot(now = Date.now()) {
  const byProvider = {};
  for (const entry of limits.values()) {
    if (entry.until <= now) continue;
    const prev = byProvider[entry.provider];
    if (!prev || entry.until > prev.until) {
      byProvider[entry.provider] = Object.freeze({ ...entry });
    }
  }
  version += 1;
  snapshot = Object.freeze({ version, byProvider: Object.freeze(byProvider) });
}

function emit(detail) {
  rebuildSnapshot();
  for (const fn of [...listeners]) {
    try {
      fn(snapshot, detail);
    } catch {
      /* a broken listener must not break the fetch path */
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail }));
    } catch {
      /* CustomEvent unavailable — listeners above already ran */
    }
  }
}

function armExpiry(provider, until) {
  const prev = expiryTimers.get(provider);
  if (prev) clearTimeout(prev);
  const delay = Math.max(0, until - Date.now()) + 50;
  const timer = setTimeout(() => {
    expiryTimers.delete(provider);
    pruneExpired();
    emit({ provider, until: null, cleared: true });
  }, delay);
  // Never keep a node test process alive for a pending expiry.
  timer?.unref?.();
  expiryTimers.set(provider, timer);
}

function pruneExpired(now = Date.now()) {
  for (const [k, entry] of limits) if (entry.until <= now) limits.delete(k);
}

/**
 * Record that `provider` (optionally one bucket) is limited until `until`
 * (epoch ms). Extends, never shortens, an existing entry.
 */
export function markRateLimited(provider, { until, kind = "primary", bucket = null } = {}) {
  if (!provider || !Number.isFinite(until)) return null;
  const key = stateKey(provider, bucket);
  const prev = limits.get(key);
  if (prev && prev.until >= until) return prev;
  const entry = {
    provider,
    bucket: bucket || null,
    kind,
    until,
    since: prev?.since ?? Date.now(),
  };
  limits.set(key, entry);
  const providerUntil = rateLimitedUntil(provider) ?? until;
  armExpiry(provider, providerUntil);
  emit({ provider, bucket: entry.bucket, kind, until: providerUntil });
  return entry;
}

/** The active limit that would block a request to (provider, bucket), or null. */
export function getRateLimit(provider, bucket = null, now = Date.now()) {
  if (!provider) return null;
  const candidates = [limits.get(stateKey(provider, null))];
  if (bucket) candidates.push(limits.get(stateKey(provider, bucket)));
  let best = null;
  for (const entry of candidates) {
    if (entry && entry.until > now && (!best || entry.until > best.until)) best = entry;
  }
  return best;
}

/** Latest `until` across every bucket of `provider`, or null when free. */
export function rateLimitedUntil(provider, now = Date.now()) {
  let until = null;
  for (const entry of limits.values()) {
    if (entry.provider === provider && entry.until > now) {
      until = until === null ? entry.until : Math.max(until, entry.until);
    }
  }
  return until;
}

/** Drop one provider's limits (or all). Tests + sign-out. */
export function clearRateLimits(provider) {
  for (const [k, entry] of limits) {
    if (!provider || entry.provider === provider) limits.delete(k);
  }
  for (const [p, timer] of expiryTimers) {
    if (!provider || p === provider) {
      clearTimeout(timer);
      expiryTimers.delete(p);
    }
  }
  emit({ provider: provider || null, until: null, cleared: true });
}

/** useSyncExternalStore plumbing. Snapshot is stable between changes. */
export function subscribeRateLimits(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getRateLimitSnapshot() {
  return snapshot;
}

const SERVER_SNAPSHOT = Object.freeze({ version: 0, byProvider: Object.freeze({}) });
export function getServerRateLimitSnapshot() {
  return SERVER_SNAPSHOT;
}

/* ─────────────────────────── fetch ─────────────────────────── */

/** Cancellable sleep. Rejects with an AbortError if the signal fires. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

const LABELS = { github: "GitHub", gitlab: "GitLab", jira: "Jira", jenkins: "Jenkins", ai: "AI provider" };
export function rateLimitProviderLabel(provider) {
  return LABELS[provider] || provider || "Upstream";
}

/**
 * The Response a limited provider gets instead of a network call: a 429
 * with our API's envelope, so every existing caller's "is this a rate
 * limit?" branch takes it as one. `x-devhub-local-rate-limit` tells
 * callers no request was sent.
 */
export function localRateLimitedResponse(entry, now = Date.now()) {
  const waitMs = Math.max(0, entry.until - now);
  const body = {
    error: {
      code: "rate_limited",
      message: `${rateLimitProviderLabel(entry.provider)} rate limit reached. Trying again after ${new Date(entry.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
      retryAfterMs: waitMs,
      until: entry.until,
      provider: entry.provider,
    },
  };
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(Math.max(1, Math.ceil(waitMs / 1000))),
      "x-devhub-local-rate-limit": "1",
    },
  });
}

/**
 * Run `fetch(input, init)` under the provider's circuit breaker. Returns
 * the final Response (callers read `.ok` / `.json()` as usual). Throws
 * only on a network error or an abort.
 *
 * opts:
 *   provider     — "github" | "gitlab" | "jira" | "jenkins" | "ai"
 *   bucket       — GitHub budget the request draws from ("search" | "core")
 *   signal       — abort signal (also cancels the one short retry wait)
 *   maxAttempts  — 1 disables even the short retry (default 2)
 *   fetchImpl    — injectable for tests
 *
 * Only for idempotent reads or requests a 429 guarantees were NOT
 * processed (a rate-limited request never reached the handler).
 */
export async function fetchWithRateLimitRetry(input, init = {}, opts = {}) {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    signal,
    provider = "upstream",
    bucket = null,
    fetchImpl = globalThis.fetch,
  } = opts;
  const requestInit = signal ? { ...init, signal } : init;

  const active = getRateLimit(provider, bucket);
  if (active) return localRateLimitedResponse(active);

  for (let attempt = 1; ; attempt += 1) {
    const res = await fetchImpl(input, requestInit);
    if (res.ok || (res.status !== 429 && res.status !== 403)) return res;

    let bodyText = "";
    try {
      bodyText = await res.clone().text();
    } catch {
      /* unreadable body — headers still decide */
    }
    const limit = detectRateLimit(res.status, res.headers, bodyText);
    if (!limit) return res;

    if (limit.waitMs <= SHORT_RETRY_MAX_MS && attempt < Math.min(maxAttempts, 2)) {
      // Brief blip: wait in place once rather than failing the tile.
      await sleep(limit.waitMs, signal);
      continue;
    }

    // Long (or repeated) limit: open the breaker and fail fast. GitHub's
    // primary limit carries its bucket; a secondary limit covers the
    // whole provider.
    const recordBucket =
      limit.kind === "primary" && provider === "github"
        ? limit.resource || bucket || null
        : null;
    markRateLimited(provider, {
      until: Date.now() + Math.max(limit.waitMs, 1_000),
      kind: limit.kind,
      bucket: recordBucket,
    });
    return res;
  }
}
