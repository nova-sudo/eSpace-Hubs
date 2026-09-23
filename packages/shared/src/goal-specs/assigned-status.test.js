import test from "node:test";
import assert from "node:assert/strict";

import {
  assignedGoalId,
  isAssignedGoalId,
  parseAssignedGoalId,
  ASSIGNED_ROOT_ID,
} from "./assigned.js";
import { assignedWindows, periodStatuses, summarizeStatuses } from "./assigned-status.js";

const DAY = 86_400_000;
const HEX = "65f0c0ffee0000000000abcd";

const monthly = {
  widget: "COMPOSED",
  fields: [
    { id: "done", kind: "checkbox", label: "Done" },
    { id: "notes", kind: "text", label: "Notes" },
  ],
  composed: {
    cadence: "monthly",
    cycleStart: "2026-01-01",
    cycleEnd: "2026-03-31",
    periods: [
      { label: "January", dueAt: "2026-01-25" },
      { label: "February" },
      { label: "March" },
    ],
  },
};

test("id helpers round-trip and reject the root", () => {
  const id = assignedGoalId(HEX);
  assert.equal(id, `asg_${HEX}`);
  assert.ok(isAssignedGoalId(id));
  assert.ok(isAssignedGoalId(ASSIGNED_ROOT_ID));
  assert.equal(parseAssignedGoalId(id), HEX);
  assert.equal(parseAssignedGoalId(ASSIGNED_ROOT_ID), null);
  assert.equal(parseAssignedGoalId("asg_nothex"), null);
  assert.equal(isAssignedGoalId("l2-1"), false);
});

test("windows follow the cycle bounds", () => {
  const w = assignedWindows(monthly, Date.UTC(2026, 1, 10));
  assert.deepEqual(w.map((x) => x.key), ["2026-01", "2026-02", "2026-03"]);
});

test("on time / late / missing / open / upcoming", () => {
  const now = Date.UTC(2026, 1, 10); // Feb 10
  const cells = periodStatuses({
    spec: monthly,
    now,
    entries: [
      // Jan: submitted Jan 26 — after the authored dueAt (Jan 25) → late
      { ts: Date.UTC(2026, 0, 15), createdAt: new Date(Date.UTC(2026, 0, 26, 9)), value: { periodKey: "2026-01", values: { done: true } } },
    ],
  });
  assert.equal(cells[0].status, "late");
  assert.equal(cells[0].label, "January");
  assert.equal(cells[0].filledFields, 1);
  assert.equal(cells[0].totalFields, 2);
  assert.equal(cells[1].status, "open");
  assert.equal(cells[2].status, "upcoming");

  const later = periodStatuses({ spec: monthly, now: Date.UTC(2026, 2, 5), entries: [] });
  assert.equal(later[0].status, "missing");
  assert.equal(later[1].status, "missing");
  assert.equal(later[2].status, "open");
});

test("grace moves the deadline", () => {
  const entries = [
    { ts: 0, createdAt: Date.UTC(2026, 0, 26, 5), value: { periodKey: "2026-01", values: { done: true } } },
  ];
  const strict = periodStatuses({ spec: monthly, now: Date.UTC(2026, 1, 1), entries });
  assert.equal(strict[0].status, "late");
  const lenient = periodStatuses({ spec: monthly, now: Date.UTC(2026, 1, 1), entries, graceMs: 12 * 3600_000 });
  assert.equal(lenient[0].status, "on_time");
  assert.equal(lenient[0].deadline, Date.UTC(2026, 0, 26) + 12 * 3600_000);
});

test("no dueAt → deadline is the window end", () => {
  const cells = periodStatuses({
    spec: monthly,
    now: Date.UTC(2026, 2, 10),
    entries: [
      { createdAt: Date.UTC(2026, 1, 28, 23), value: { periodKey: "2026-02", values: {} } },
    ],
  });
  assert.equal(cells[1].deadline, Date.UTC(2026, 2, 1));
  assert.equal(cells[1].status, "on_time");
});

test("first save is submission, last save is last edit", () => {
  const cells = periodStatuses({
    spec: monthly,
    now: Date.UTC(2026, 1, 10),
    entries: [
      { createdAt: Date.UTC(2026, 0, 20), value: { periodKey: "2026-01", values: { done: true } } },
      { createdAt: Date.UTC(2026, 0, 28), value: { periodKey: "2026-01", values: { done: true, notes: "x" } } },
    ],
  });
  assert.equal(cells[0].status, "on_time");
  assert.equal(cells[0].submittedAt, Date.UTC(2026, 0, 20));
  assert.equal(cells[0].lastEditedAt, Date.UTC(2026, 0, 28));
  assert.equal(cells[0].filledFields, 2);
});

test("legacy rows fall back to ts and are approx; periodKey beats ts", () => {
  const cells = periodStatuses({
    spec: monthly,
    now: Date.UTC(2026, 2, 10),
    entries: [
      { ts: Date.UTC(2026, 1, 3), value: { values: { done: true } } },
      { ts: Date.UTC(2026, 1, 3), createdAt: Date.UTC(2026, 1, 3), value: { periodKey: "2026-01", values: {} } },
    ],
  });
  assert.equal(cells[1].status, "on_time");
  assert.equal(cells[1].approx, true);
  assert.equal(cells[0].status, "late");
  assert.equal(cells[0].approx, false);
});

test("one-time plan is a single window", () => {
  const spec = { widget: "COMPOSED", fields: [], composed: { cadence: null, cycleStart: "2026-01-01", cycleEnd: "2026-06-30" } };
  const cells = periodStatuses({ spec, now: Date.UTC(2026, 7, 1), entries: [] });
  assert.equal(cells.length, 1);
  assert.equal(cells[0].key, null);
  assert.equal(cells[0].status, "missing");
});

test("summarizeStatuses counts only due windows in rates", () => {
  const s = summarizeStatuses([
    { status: "on_time" }, { status: "late" }, { status: "missing" }, { status: "open" }, { status: "upcoming" },
  ]);
  assert.equal(s.due, 3);
  assert.equal(s.completionRate, 2 / 3);
  assert.equal(s.onTimeRate, 1 / 3);
});

test("timezone: end of the due day is local — 23:30 Cairo on the due day is on time", () => {
  // Jan 25 is due. Cairo is UTC+2 in January → deadline = Jan 25 22:00 UTC.
  const at = Date.UTC(2026, 0, 25, 21, 30); // 23:30 Cairo
  const entries = [{ createdAt: at, value: { periodKey: "2026-01", values: { done: true } } }];
  const cairo = periodStatuses({ spec: monthly, now: Date.UTC(2026, 1, 1), entries, timeZone: "Africa/Cairo" });
  assert.equal(cairo[0].deadline, Date.UTC(2026, 0, 25, 22));
  assert.equal(cairo[0].status, "on_time");
  const late = [{ createdAt: Date.UTC(2026, 0, 25, 22, 30), value: { periodKey: "2026-01", values: {} } }];
  assert.equal(
    periodStatuses({ spec: monthly, now: Date.UTC(2026, 1, 1), entries: late, timeZone: "Africa/Cairo" })[0].status,
    "late",
  );
});

test("nested entries count toward their window; the management half doesn't", () => {
  const cells = periodStatuses({
    spec: monthly,
    now: Date.UTC(2026, 2, 10),
    entries: [
      { createdAt: Date.UTC(2026, 0, 10), value: { periodKey: "2026-01::2026-W2", values: { x: 1 } } },
      { createdAt: Date.UTC(2026, 1, 10), value: { periodKey: "mgmt::2026-02", values: { x: 1 } } },
    ],
  });
  assert.equal(cells[0].status, "on_time");
  assert.equal(cells[1].status, "missing");
});
