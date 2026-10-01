import test from "node:test";
import assert from "node:assert/strict";

import { createManifestBatcher, MANIFEST_BATCH_MAX } from "./manifest-batcher.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

test("manifest reads in one tick become ONE batched request", async () => {
  const calls = [];
  const fetchOne = createManifestBatcher({
    request: async (ids) => {
      calls.push(ids);
      return Object.fromEntries(ids.map((id) => [id, [{ id: `${id}-f`, name: "x" }]]));
    },
    fallback: async () => {
      throw new Error("should not fall back");
    },
  });
  const ids = Array.from({ length: 13 }, (_, i) => `g${i}`);
  const results = await Promise.all(ids.map((id) => fetchOne(id)));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ids);
  assert.equal(results[4][0].id, "g4-f");
});

test("duplicate goal ids share one slot; missing goals resolve empty", async () => {
  const calls = [];
  const fetchOne = createManifestBatcher({
    request: async (ids) => {
      calls.push(ids);
      return { a: [{ id: 1 }] };
    },
    fallback: async () => [],
  });
  const [a1, a2, b] = await Promise.all([fetchOne("a"), fetchOne("a"), fetchOne("b")]);
  assert.deepEqual(calls, [["a", "b"]]);
  assert.equal(a1, a2);
  assert.deepEqual(b, []);
});

test("batches are chunked at the server cap", async () => {
  const sizes = [];
  const fetchOne = createManifestBatcher({
    request: async (ids) => {
      sizes.push(ids.length);
      return {};
    },
    fallback: async () => [],
  });
  await Promise.all(Array.from({ length: MANIFEST_BATCH_MAX + 5 }, (_, i) => fetchOne(`g${i}`)));
  assert.deepEqual(sizes, [MANIFEST_BATCH_MAX, 5]);
});

test("an API without the batch route falls back to per-goal reads", async () => {
  const fallbacks = [];
  const fetchOne = createManifestBatcher({
    request: async () => {
      throw new Error("404");
    },
    fallback: async (id) => {
      fallbacks.push(id);
      return [{ id }];
    },
  });
  const r = await Promise.all([fetchOne("a"), fetchOne("b")]);
  await tick();
  assert.deepEqual(fallbacks.sort(), ["a", "b"]);
  assert.deepEqual(r[1], [{ id: "b" }]);
});
