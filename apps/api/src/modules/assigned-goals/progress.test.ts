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
  assert.deepEqual(p.windows[0].counts, { onTime: 1, late: 1, missing: 0, open: 0, upcoming: 0 });
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
