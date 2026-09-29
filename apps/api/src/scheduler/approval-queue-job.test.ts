import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

import {
  approverFor,
  goalTitlesByOwner,
  staleQueues,
  type PendingApproval,
} from "./approval-queue-job.js";
import { isMutableKind, kindDelivered } from "../lib/notifications.js";

const org = new ObjectId();
const mgr = new ObjectId();
const DAY = 86_400_000;
const now = new Date("2026-09-28T12:00:00Z");

test("approverFor: an active manager decides", () => {
  const byId = new Map([[mgr.toHexString(), { status: "active" as const }]]);
  assert.deepEqual(approverFor({ managerId: mgr }, byId), {
    scope: "manager",
    managerId: mgr.toHexString(),
  });
});

test("approverFor: no manager, a disabled one, or a dangling id → the admins", () => {
  const byId = new Map([[mgr.toHexString(), { status: "disabled" as const }]]);
  assert.deepEqual(approverFor({ managerId: null }, byId), { scope: "admins" });
  assert.deepEqual(approverFor({ managerId: mgr }, byId), { scope: "admins" });
  assert.deepEqual(approverFor({ managerId: new ObjectId() }, new Map()), { scope: "admins" });
});

function item(daysAgo: number, approver: PendingApproval["approver"]): PendingApproval {
  return {
    specId: String(new ObjectId()),
    orgId: org,
    ownerId: new ObjectId(),
    ownerName: "R",
    goalId: "g",
    title: "t",
    submittedAt: now.getTime() - daysAgo * DAY,
    approver,
  };
}

test("staleQueues groups >3-day items per approver and reports the oldest wait", () => {
  const m = { scope: "manager" as const, managerId: mgr.toHexString() };
  const queues = staleQueues(
    [item(5, m), item(4, m), item(1, m), item(10, { scope: "admins" })],
    now,
  );
  assert.equal(queues.length, 2);
  const mq = queues.find((q) => q.approver.scope === "manager");
  assert.equal(mq?.stale, 2);
  assert.equal(mq?.oldestDays, 5);
  const aq = queues.find((q) => q.approver.scope === "admins");
  assert.equal(aq?.stale, 1);
});

test("staleQueues ignores queues whose items are all fresh", () => {
  const m = { scope: "manager" as const, managerId: mgr.toHexString() };
  assert.deepEqual(staleQueues([item(2, m), item(0, m)], now), []);
});

test("kindDelivered honours per-kind mutes", () => {
  assert.equal(kindDelivered({ muted: [], email: true }, "goal_stale"), true);
  assert.equal(kindDelivered({ muted: ["goal_stale"], email: true }, "goal_stale"), false);
  assert.equal(kindDelivered({ muted: ["goal_stale"], email: true }, "goal_overdue"), true);
});

test("goalTitlesByOwner: only goals still in the owner's tree are queueable", () => {
  const owner = new ObjectId();
  const map = goalTitlesByOwner([
    {
      userId: owner,
      l1s: [
        { id: "l1", title: "L1", l2s: [{ id: "g-live", title: "Ship it" }] },
      ] as never,
    },
  ]);
  assert.equal(map.get(owner.toHexString())?.get("g-live"), "Ship it");
  assert.equal(map.get(owner.toHexString())?.get("g-deleted"), undefined);
  assert.equal(map.get(new ObjectId().toHexString()), undefined, "no tree → nothing queueable");
});

test("approval kinds can't be muted by the people who must act on them", () => {
  for (const kind of ["goal_submitted", "approval_waiting", "approval_queue_stale"] as const) {
    assert.equal(isMutableKind(kind), false, kind);
    assert.equal(kindDelivered({ muted: [kind], email: true }, kind), true, kind);
  }
  assert.equal(isMutableKind("goal_stale"), true);
});
