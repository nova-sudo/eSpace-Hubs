import test from "node:test";
import assert from "node:assert/strict";

import { buildProgress } from "./progress.js";

const spec = {
  widget: "COMPOSED",
  fields: [{ id: "done", kind: "checkbox", label: "Done" }],
  composed: { cadence: "monthly", cycleStart: "2026-01-01", cycleEnd: "2026-03-31" },
};

test("rows × windows with per-window counts and totals", () => {
  const p = buildProgress({
    spec,
    graceHours: 0,
    now: Date.UTC(2026, 1, 15),
    users: [
      { id: "a", displayName: "A", email: null },
      { id: "b", displayName: "B", email: null },
    ],
    entries: [
      { userId: "a", ts: Date.UTC(2026, 0, 10), createdAt: new Date(Date.UTC(2026, 0, 10)), value: { periodKey: "2026-01", values: { done: true } } },
      { userId: "b", ts: Date.UTC(2026, 0, 10), createdAt: new Date(Date.UTC(2026, 1, 3)), value: { periodKey: "2026-01", values: { done: true } } },
    ],
  });
  assert.deepEqual(p.windows.map((w) => w.key), ["2026-01", "2026-02", "2026-03"]);
  assert.deepEqual(p.windows[0].counts, { onTime: 1, late: 1, missing: 0, open: 0, upcoming: 0, before: 0, closedOnGithub: 0 });
  assert.equal(p.windows[1].counts.open, 2);
  assert.equal(p.rows[0].cells[0].status, "on_time");
  assert.equal(p.rows[1].cells[0].status, "late");
  assert.equal(p.totals.assignees, 2);
  assert.equal(p.totals.completionRate, 1);
  assert.equal(p.totals.onTimeRate, 0.5);
});

test("no assignees still yields the window grid", () => {
  const p = buildProgress({ spec, graceHours: 0, users: [], entries: [], now: Date.UTC(2026, 1, 1) });
  assert.equal(p.windows.length, 3);
  assert.equal(p.totals.due, 0);
});

test("windows that ended before the goal was assigned are 'before', not missing", () => {
  const p = buildProgress({
    spec,
    graceHours: 0,
    now: Date.UTC(2026, 2, 15),
    trackingStart: Date.UTC(2026, 1, 10), // assigned mid-February
    users: [{ id: "a", displayName: "A", email: null }],
    entries: [],
  });
  assert.deepEqual(p.rows[0].cells.map((c) => c.status), ["before", "missing", "open"]);
  assert.equal(p.windows[0].counts.before, 1);
  assert.equal(p.totals.missing, 1);
  assert.equal(p.totals.due, 1);
});

test("linked GitHub issues annotate cells by (user, period) without changing statuses", () => {
  const p = buildProgress({
    spec,
    graceHours: 0,
    now: Date.UTC(2026, 1, 15),
    users: [
      { id: "a", displayName: "A", email: null },
      { id: "b", displayName: "B", email: null },
    ],
    entries: [
      { userId: "a", ts: Date.UTC(2026, 0, 10), createdAt: new Date(Date.UTC(2026, 0, 10)), value: { periodKey: "2026-01", values: { done: true } } },
    ],
    links: [
      {
        userId: "a",
        periodIndex: 0,
        issueState: "closed",
        issueNumber: 12,
        issueUrl: "https://github.com/acme/app/issues/12",
        tasks: { done: 3, total: 3 },
        closedAt: new Date(Date.UTC(2026, 0, 10)),
        lastSyncedAt: new Date(Date.UTC(2026, 1, 14)),
        stale: false,
      },
      {
        userId: "b",
        periodIndex: 1,
        issueState: "open",
        issueUrl: "https://github.com/acme/app/issues/13",
        tasks: { done: 2, total: 5 },
        closedAt: null,
        lastSyncedAt: null,
        stale: true,
      },
      {
        userId: "b",
        periodIndex: 0,
        issueState: "closed",
        stateReason: "not_planned",
        issueUrl: "https://github.com/acme/app/issues/14",
        tasks: null,
        closedAt: new Date(Date.UTC(2026, 0, 20)),
        lastSyncedAt: null,
        stale: false,
      },
    ],
  });
  const a = p.rows[0]!.cells;
  const b = p.rows[1]!.cells;
  assert.equal(a[0]!.status, "on_time");
  assert.deepEqual(a[0]!.github, {
    state: "closed",
    stateReason: null,
    issueNumber: 12,
    issueUrl: "https://github.com/acme/app/issues/12",
    tasks: { done: 3, total: 3 },
    closedAt: "2026-01-10T00:00:00.000Z",
    lastSyncedAt: "2026-02-14T00:00:00.000Z",
    stale: false,
  });
  assert.equal(a[1]!.github, null);
  // A closed issue without a reading never flips the status on its own.
  assert.equal(b[0]!.status, "missing");
  assert.equal(b[1]!.github?.state, "open");
  assert.equal(b[1]!.github?.stale, true);
  assert.equal(b[1]!.status, "open");
  // "not planned" isn't closed-as-done.
  assert.equal(p.windows[0]!.counts.closedOnGithub, 1);
  assert.equal(p.windows[1]!.counts.closedOnGithub, 0);
  assert.equal(p.totals.closedOnGithub, 1);
});

test("no links → every cell's github is null and the counts are zero", () => {
  const p = buildProgress({
    spec,
    graceHours: 0,
    now: Date.UTC(2026, 1, 15),
    users: [{ id: "a", displayName: "A", email: null }],
    entries: [],
  });
  assert.ok(p.rows[0]!.cells.every((c) => c.github === null));
  assert.equal(p.totals.closedOnGithub, 0);
});
