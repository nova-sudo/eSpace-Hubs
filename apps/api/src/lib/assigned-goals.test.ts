import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import { stripAssigned, syntheticAssignedL1 } from "./assigned-goals-tree.js";
import type { AssignedGoal } from "../db/types.js";

function doc(over: Partial<AssignedGoal> = {}): AssignedGoal {
  const now = new Date("2026-09-01T00:00:00Z");
  return {
    _id: new ObjectId("65f0c0ffee0000000000abcd"),
    orgId: new ObjectId(),
    createdBy: new ObjectId(),
    createdByName: "Mona",
    code: "SH-1",
    title: "Weekly demo",
    description: "",
    spec: { widget: "COMPOSED", composed: { cadence: "weekly", cycleStart: "2026-09-01", cycleEnd: "2026-11-30" } },
    assigneeIds: [],
    viewerIds: [],
    graceHours: 12,
    status: "active",
    archivedAt: null,
    specRevision: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

test("stripAssigned drops the synthetic L1 and any asg_ L2 a client echoed back", () => {
  const l1s = [
    { id: "l1", l2s: [{ id: "a" }, { id: "asg_65f0c0ffee0000000000abcd" }] },
    { id: "asg__root", l2s: [{ id: "asg_65f0c0ffee0000000000abcd" }] },
  ];
  assert.deepEqual(stripAssigned(l1s), [{ id: "l1", l2s: [{ id: "a" }] }]);
});

test("synthetic tree: weightage 0, asg_ ids, cycle dates, creator marker", () => {
  assert.equal(syntheticAssignedL1([]), null);
  const root = syntheticAssignedL1([doc()])!;
  assert.equal(root.id, "asg__root");
  assert.equal(root.weightage, 0);
  const l2 = root.l2s[0] as (typeof root.l2s)[number] & { assigned: { byName: string; graceHours: number } };
  assert.equal(l2.id, "asg_65f0c0ffee0000000000abcd");
  assert.equal(l2.weightage, 0);
  assert.equal(l2.startDate, "2026-09-01");
  assert.equal(l2.dueDate, "2026-11-30");
  assert.equal(l2.assigned.byName, "Mona");
  assert.equal(l2.assigned.graceHours, 12);
});
