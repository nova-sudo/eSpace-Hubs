import test from "node:test";
import assert from "node:assert/strict";
import {
  clearProviderCache,
  createLocalStorageBackend,
  createMemoryBackend,
  createProviderCache,
  isJsonSafe,
  isProviderKey,
  LS_KEY,
  providerCache,
  providersForKey,
} from "./provider-cache.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    raw: map,
  };
}

test("only provider keys are cached", () => {
  assert.equal(isProviderKey("github:merged:2026-01-01"), true);
  assert.equal(isProviderKey("gh_actions:runs:a/b:x"), true);
  assert.equal(isProviderKey("jira:my-issues"), true);
  assert.equal(isProviderKey("/notifications"), false);
  assert.equal(isProviderKey("pr-review-timings:2026-10-01:1"), false);
  assert.equal(isProviderKey(null), false);
  assert.deepEqual(providersForKey("gh_actions:runs:x"), ["github"]);
  assert.deepEqual(providersForKey("combined:x"), ["github", "gitlab"]);
});

test("non-JSON shapes (Map, Date) are never persisted", () => {
  assert.equal(isJsonSafe({ a: [1, "x", null, { b: true }] }), true);
  assert.equal(isJsonSafe(new Map()), false);
  assert.equal(isJsonSafe({ when: new Date() }), false);
  assert.equal(isJsonSafe({ n: Number.NaN }), false);
});

test("entries are namespaced by user: B never sees A's data", async () => {
  const backend = createMemoryBackend();
  const cache = createProviderCache({ backend, now: () => 1_000 });
  await cache.load("user-a");
  await cache.write("github:merged:ytd", [{ id: 1 }], 900);
  // Same device, user B loads: nothing, and A's row is dropped.
  const forB = await cache.load("user-b");
  assert.deepEqual(forB, {});
  await cache.flush();
  assert.equal((await backend.getAll()).length, 0);
});

test("load returns last-known data with its fetchedAt as persisted", async () => {
  const backend = createMemoryBackend();
  const writer = createProviderCache({ backend, now: () => 5_000 });
  await writer.load("u1");
  await writer.write("jira:my-issues", { issues: [1, 2] }, 4_000);
  await writer.write("/notifications", { x: 1 }); // ignored — not a provider key

  const reader = createProviderCache({ backend, now: () => 6_000 });
  const fallback = await reader.load("u1");
  assert.deepEqual(fallback, { "jira:my-issues": { issues: [1, 2] } });
  assert.deepEqual(reader.freshness("jira:my-issues"), { fetchedAt: 4_000, source: "persisted" });
  assert.equal(reader.latestFetchedAtFor("jira"), 4_000);
});

test("entries past maxAge are dropped on load", async () => {
  const backend = createMemoryBackend();
  let t = 0;
  const cache = createProviderCache({ backend, maxAgeMs: 100, now: () => t });
  await cache.load("u1");
  await cache.write("github:repos", [1], 0);
  t = 500;
  assert.deepEqual(await cache.load("u1"), {});
});

test("size cap evicts least-recently-used entries", async () => {
  const backend = createMemoryBackend();
  let t = 0;
  const cache = createProviderCache({
    backend,
    maxTotalBytes: 300,
    maxEntryBytes: 200,
    now: () => t,
  });
  await cache.load("u1");
  const payload = "x".repeat(40); // ~ (40+2)*2 = 84 bytes
  t = 1;
  await cache.write("github:a", payload);
  t = 2;
  await cache.write("github:b", payload);
  t = 3;
  cache.touch("github:a"); // a is now more recent than b
  t = 4;
  await cache.write("github:c", payload);
  t = 5;
  await cache.write("github:d", payload); // over 300 → evict LRU (b)
  const keys = cache.keys().sort();
  assert.deepEqual(keys, ["github:a", "github:c", "github:d"]);
  const stored = (await backend.getAll()).map((r) => r.key).sort();
  assert.deepEqual(stored, ["github:a", "github:c", "github:d"]);
});

test("an entry over the per-entry cap is not persisted", async () => {
  const backend = createMemoryBackend();
  const cache = createProviderCache({ backend, maxTotalBytes: 10_000, maxEntryBytes: 50 });
  await cache.load("u1");
  assert.equal(await cache.write("github:big", "y".repeat(100)), false);
  assert.equal((await backend.getAll()).length, 0);
  // Freshness is still recorded — the value is live, just not persisted.
  assert.ok(cache.freshness("github:big"));
});

test("clear() wipes every user and drops in-flight writes", async () => {
  const backend = createMemoryBackend();
  const cache = createProviderCache({ backend });
  await cache.load("u1");
  const pending = cache.write("gitlab:merged:x", [1]);
  cache.clear();
  await pending;
  await cache.flush();
  assert.equal((await backend.getAll()).length, 0);
  assert.equal(cache.freshness("gitlab:merged:x"), null);
  assert.deepEqual(await cache.load("u1"), {});
});

test("localStorage fallback backend round-trips and clears its key", async () => {
  const storage = fakeStorage();
  const backend = createLocalStorageBackend(storage);
  const cache = createProviderCache({ backend });
  await cache.load("u1");
  await cache.write("jenkins:jobs", ["build"]);
  assert.ok(storage.raw.has(LS_KEY));
  const again = createProviderCache({ backend });
  assert.deepEqual(await again.load("u1"), { "jenkins:jobs": ["build"] });
  await again.clear();
  assert.equal(storage.raw.has(LS_KEY), false);
});

test("localStorage backend survives a throwing storage", async () => {
  const broken = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceeded");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  const cache = createProviderCache({ backend: createLocalStorageBackend(broken) });
  assert.deepEqual(await cache.load("u1"), {});
  await cache.write("github:x", [1]);
  await cache.clear();
});

test("clearProviderCache (the sign-out hook) empties the app singleton", async () => {
  await providerCache.load("u-signout");
  await providerCache.write("github:merged:ytd", [{ id: 7 }]);
  assert.deepEqual(providerCache.keys(), ["github:merged:ytd"]);
  await clearProviderCache();
  assert.equal(providerCache.userId, null);
  assert.deepEqual(await providerCache.load("u-signout"), {});
});
