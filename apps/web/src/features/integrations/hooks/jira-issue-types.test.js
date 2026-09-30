import test from "node:test";
import assert from "node:assert/strict";

import { partitionCachedKeys, resolveIssueTypesInBatches } from "./use-jira-issue-types.js";

test("only keys the per-key cache can't answer go on the wire", () => {
  const cache = new Map([
    ["ABC-1", "bug"],
    ["ABC-2", ""], // Jira didn't return it last time — still a known answer
  ]);
  const { known, missing } = partitionCachedKeys(["ABC-1", "ABC-2", "ABC-3"], (k) => cache.get(k));
  assert.deepEqual(known, { "ABC-1": "bug", "ABC-2": "" });
  assert.deepEqual(missing, ["ABC-3"]);
});

test("a new PR only sends its own new key, not every batch again", async () => {
  const cache = new Map(Array.from({ length: 120 }, (_, i) => [`K-${i}`, "story"]));
  const keys = [...cache.keys(), "K-NEW"];
  const { missing } = partitionCachedKeys(keys, (k) => cache.get(k));
  const sent = [];
  await resolveIssueTypesInBatches(missing, async (chunk) => {
    sent.push(chunk);
    return { "K-NEW": "bug" };
  }, (resolved) => Object.entries(resolved).forEach(([k, v]) => cache.set(k, v)));
  assert.deepEqual(sent, [["K-NEW"]]);
  assert.equal(cache.get("K-NEW"), "bug");
});

test("a failed batch is not cached as success and fails the fetch; good batches are kept", async () => {
  const cache = new Map();
  const keys = Array.from({ length: 120 }, (_, i) => `K-${i}`);
  let call = 0;
  await assert.rejects(
    resolveIssueTypesInBatches(
      keys,
      async (chunk) => {
        call += 1;
        if (call === 2) throw Object.assign(new Error("429"), { rateLimited: true });
        return Object.fromEntries(chunk.map((k) => [k, "bug"]));
      },
      (resolved) => Object.entries(resolved).forEach(([k, v]) => cache.set(k, v)),
      50,
    ),
    /429/,
  );
  assert.equal(call, 3, "later batches still run");
  assert.equal(cache.size, 70, "batches 1 and 3 cached");
  assert.equal(cache.has("K-50"), false, "the failed batch's keys stay missing → retried later");
  // The retry sends ONLY the failed batch.
  const { missing } = partitionCachedKeys(keys, (k) => cache.get(k));
  assert.equal(missing.length, 50);
  assert.equal(missing[0], "K-50");
});
