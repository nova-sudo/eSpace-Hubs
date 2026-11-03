import test from "node:test";
import assert from "node:assert/strict";

import { uniqueGoalIds } from "./unique-ids.js";

function l1(id, l2s = []) {
  return { id, code: "", title: id, l2s };
}

test("uniqueGoalIds leaves a tree with distinct ids untouched (same reference)", () => {
  const l1s = [l1("a", [{ id: "a1" }]), l1("b", [{ id: "b1" }])];
  assert.equal(uniqueGoalIds(l1s), l1s);
});

test("uniqueGoalIds suffixes repeated L1 ids deterministically, first wins", () => {
  const l1s = [l1("x", [{ id: "1" }]), l1("x", [{ id: "2" }]), l1("x", [{ id: "3" }]), l1("y")];
  const out = uniqueGoalIds(l1s);
  assert.deepEqual(
    out.map((o) => o.id),
    ["x", "x~2", "x~3", "y"],
  );
  // L2s and other fields ride along; input is not mutated.
  assert.deepEqual(out[1].l2s, [{ id: "2" }]);
  assert.equal(l1s[1].id, "x");
  // Re-running is a no-op — the suffixed ids are stable across GET → PUT.
  assert.equal(uniqueGoalIds(out), out);
});

test("uniqueGoalIds suffixes L2 ids that repeat anywhere in the tree", () => {
  const l1s = [l1("a", [{ id: "g" }, { id: "g" }]), l1("b", [{ id: "g" }])];
  const out = uniqueGoalIds(l1s);
  assert.deepEqual(
    out.flatMap((o) => o.l2s.map((x) => x.id)),
    ["g", "g~2", "g~3"],
  );
});

test("uniqueGoalIds skips a suffix that is already taken", () => {
  const l1s = [l1("x"), l1("x~2"), l1("x")];
  assert.deepEqual(
    uniqueGoalIds(l1s).map((o) => o.id),
    ["x", "x~2", "x~3"],
  );
});
