import test from "node:test";
import assert from "node:assert/strict";

import { findGovernedGoal, tierPolicyNotificationData } from "./tier-policy-notify.js";

const tree = [
  {
    id: "l1a",
    code: "OBJ-1",
    title: "Objective A",
    l2s: [
      { id: "l2a1", code: "KR-1", title: "Ship it" },
      { id: "l2a2", code: "KR-2", title: "Test it" },
    ],
  },
  { id: "l1b", code: "OBJ-2", title: "Empty objective", l2s: [] },
  { id: "l1c", code: "", title: "Uncoded", l2s: [{ id: "l2c1", code: " OBJ-1 ", title: "Also OBJ-1" }] },
];

test("an L2 code resolves to that L2", () => {
  assert.deepEqual(findGovernedGoal(tree, "KR-2"), { goalId: "l2a2", goalTitle: "Test it" });
});

test("a direct L2 match beats an L1 match with the same code", () => {
  assert.deepEqual(findGovernedGoal(tree, "OBJ-1"), { goalId: "l2c1", goalTitle: "Also OBJ-1" });
});

test("an L1 code resolves to its first L2, or the L1 itself when it has none", () => {
  const onlyL1 = [tree[0]];
  assert.deepEqual(findGovernedGoal(onlyL1, "OBJ-1"), { goalId: "l2a1", goalTitle: "Ship it" });
  assert.deepEqual(findGovernedGoal(tree, "OBJ-2"), { goalId: "l1b", goalTitle: "Empty objective" });
});

test("no match / blank code / empty tree → null", () => {
  assert.equal(findGovernedGoal(tree, "NOPE"), null);
  assert.equal(findGovernedGoal(tree, "  "), null);
  assert.equal(findGovernedGoal(null, "KR-1"), null);
});

test("payload carries goalCode + the recipient's goalId", () => {
  assert.deepEqual(
    tierPolicyNotificationData({
      code: "KR-1",
      cycleKey: "2026",
      change: "set",
      goal: { goalId: "l2a1", goalTitle: "Ship it" },
    }),
    {
      code: "KR-1",
      goalCode: "KR-1",
      cycleKey: "2026",
      change: "set",
      goalId: "l2a1",
      goalTitle: "Ship it",
    },
  );
  assert.deepEqual(
    tierPolicyNotificationData({ code: "KR-1", cycleKey: null, change: "deleted", goal: null }),
    { code: "KR-1", goalCode: "KR-1", cycleKey: null, change: "deleted" },
  );
});
