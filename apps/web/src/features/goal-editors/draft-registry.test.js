import test from "node:test";
import assert from "node:assert/strict";

import { createDraftRegistry, flushFailed } from "./draft-registry.js";

test("flushFailed: only false and { ok: false } count as failures", () => {
  assert.equal(flushFailed(false), true);
  assert.equal(flushFailed({ ok: false }), true);
  assert.equal(flushFailed(undefined), false);
  assert.equal(flushFailed(true), false);
  assert.equal(flushFailed({ ok: true }), false);
});

test("flushAll: ok when every dirty draft saved; clean drafts are skipped", () => {
  const r = createDraftRegistry();
  const calls = [];
  r.register("a", { dirty: true, flush: () => (calls.push("a"), { ok: true }) });
  r.register("b", { dirty: false, flush: () => (calls.push("b"), { ok: false }) });
  r.register("c", { dirty: true, flush: () => calls.push("c") });
  assert.deepEqual(r.flushAll(), { ok: true, failed: [] });
  assert.deepEqual(calls, ["a", "c"]);
});

test("flushAll: reports failures in order and still flushes the rest", () => {
  const r = createDraftRegistry();
  const calls = [];
  const bad1 = { dirty: true, flush: () => (calls.push("bad1"), { ok: false }) };
  const good = { dirty: true, flush: () => (calls.push("good"), { ok: true }) };
  const bad2 = {
    dirty: true,
    flush: () => {
      calls.push("bad2");
      throw new Error("boom");
    },
  };
  r.register("1", bad1);
  r.register("2", good);
  r.register("3", bad2);
  const res = r.flushAll();
  assert.equal(res.ok, false);
  assert.deepEqual(res.failed, [bad1, bad2]);
  assert.deepEqual(calls, ["bad1", "good", "bad2"]);
});

test("anyDirty / unregister", () => {
  const r = createDraftRegistry();
  r.register("a", { dirty: true, flush: () => {} });
  assert.equal(r.anyDirty(), true);
  r.unregister("a");
  assert.equal(r.anyDirty(), false);
  assert.deepEqual(r.flushAll(), { ok: true, failed: [] });
});
