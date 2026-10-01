import test from "node:test";
import assert from "node:assert/strict";
import { wrapProviderFetcher } from "./swr-middleware.js";
import { NOT_MODIFIED } from "../api-clients/proxy-fetch.js";
import { erroredKeys, isKeyRefreshing, keyError, resetFreshnessStore } from "./freshness-store.js";

function fakeCache() {
  const writes = [];
  const confirms = [];
  return {
    writes,
    confirms,
    write: async (key, data, at) => writes.push({ key, data, at }),
    confirm: (key) => confirms.push(key),
  };
}

test("a good result is persisted with a fetchedAt and clears the error", async () => {
  resetFreshnessStore();
  const cache = fakeCache();
  const fetcher = wrapProviderFetcher("github:merged:x", async () => [1, 2], { cache });
  const out = await fetcher();
  assert.deepEqual(out, [1, 2]);
  assert.equal(cache.writes.length, 1);
  assert.ok(cache.writes[0].at > 0);
  assert.equal(isKeyRefreshing("github:merged:x"), false);
  assert.equal(keyError("github:merged:x"), null);
});

test("304 (NOT_MODIFIED) reuses the cached copy", async () => {
  resetFreshnessStore();
  const cache = fakeCache();
  const fetcher = wrapProviderFetcher("github:events:x", async () => NOT_MODIFIED, {
    cache,
    getCached: () => ["cached"],
  });
  assert.deepEqual(await fetcher(), ["cached"]);
  assert.deepEqual(cache.confirms, ["github:events:x"]);
  assert.equal(cache.writes.length, 0);
});

test("a failure is recorded for freshness + expiry revalidation, and rethrown", async () => {
  resetFreshnessStore();
  const cache = fakeCache();
  const boom = Object.assign(new Error("github 403"), { rateLimited: true });
  const fetcher = wrapProviderFetcher("github:repos", async () => {
    throw boom;
  }, { cache });
  await assert.rejects(fetcher(), boom);
  assert.equal(keyError("github:repos"), boom);
  assert.deepEqual(erroredKeys(), ["github:repos"]);
  assert.equal(cache.writes.length, 0);
});
