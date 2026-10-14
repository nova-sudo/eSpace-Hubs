import test from "node:test";
import assert from "node:assert/strict";

import { applyMarkRead } from "./inbox-model.js";
import { NOTIFICATION_KIND_GROUPS, notificationPath } from "./notification-kinds.js";

const base = {
  items: [
    { id: "a", read: false },
    { id: "b", read: true },
  ],
  unread: 1,
};

test("applyMarkRead: an unread row flips and the count drops", () => {
  const next = applyMarkRead(base, "a");
  assert.ok(next, "a change means the caller POSTs");
  assert.equal(next.items[0].read, true);
  assert.equal(next.unread, 0);
  assert.equal(base.items[0].read, false, "input is not mutated");
});

test("applyMarkRead: already-read or unknown rows are a no-op (no POST)", () => {
  assert.equal(applyMarkRead(base, "b"), null);
  assert.equal(applyMarkRead(base, "zzz"), null);
  assert.equal(applyMarkRead({ items: [], unread: 0 }, "a"), null);
});

test("applyMarkRead: a second call on the result is a no-op (double click → one POST)", () => {
  const once = applyMarkRead(base, "a");
  assert.equal(applyMarkRead(once, "a"), null);
});

test("applyMarkRead: unread never goes negative", () => {
  const next = applyMarkRead({ items: [{ id: "a", read: false }], unread: 0 }, "a");
  assert.equal(next.unread, 0);
});

// ── GitHub kinds: deep links + settings copy (notification-kinds) ──

const ASG = "65f0c0ffee0000000000abcd";

test("github_publish_requested opens the assignee's Goals page on that goal", () => {
  assert.equal(
    notificationPath({
      kind: "github_publish_requested",
      data: { assignedGoalId: ASG, goalId: `asg_${ASG}`, repo: "acme/app" },
    }),
    `/goals?goal=asg_${ASG}`,
  );
  assert.equal(notificationPath({ kind: "github_publish_requested", data: {} }), "/goals");
});

test("github_issues_published and github_issue_closed open the shared goal's progress", () => {
  for (const kind of ["github_issues_published", "github_issue_closed"]) {
    assert.equal(
      notificationPath({ kind, data: { assignedGoalId: ASG, goalId: `asg_${ASG}` } }),
      `/shared-goals/${ASG}`,
    );
    assert.equal(notificationPath({ kind, data: {} }), "/shared-goals");
  }
});

test("every github kind has a settings label (so it can be muted)", () => {
  const labelled = new Map(
    NOTIFICATION_KIND_GROUPS.flatMap((g) => g.kinds).map((k) => [k.kind, k.label]),
  );
  for (const kind of ["github_publish_requested", "github_issues_published", "github_issue_closed"]) {
    assert.ok(labelled.get(kind), `${kind} is labelled`);
  }
});

test("review_packet_submitted opens the packet page, else the roster", () => {
  assert.equal(
    notificationPath({ kind: "review_packet_submitted", data: { packetId: "p1" } }),
    "/packets/p1",
  );
  assert.equal(notificationPath({ kind: "review_packet_submitted", data: {} }), "/employees");
});
