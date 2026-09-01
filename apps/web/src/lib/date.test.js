import test from "node:test";
import assert from "node:assert/strict";

import { dueStatus, weekLabel, weekNumber, weekRangeFromLabel } from "./date.js";

// The DST regression: dayOfYear used to be computed by millisecond
// division, which ran one low for every day inside a DST period — and
// the error flipped the week number exactly on Sundays, so Sunday
// snapshots filed under the previous week and label→range→label
// round-trips weren't stable. These properties hold on any host TZ and
// fail on the old implementation wherever the host observes DST.

test("weekLabel round-trips through weekRangeFromLabel for every day of the year", () => {
  const year = 2026;
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const label = weekLabel(d);
    const range = weekRangeFromLabel(`${label}-${year}`);
    assert.ok(range, `no range for ${label}`);
    // The day must fall inside its own week: [Sunday, Sunday+7d).
    const endOfWeek = new Date(range.start);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    assert.ok(
      d >= range.start && d < endOfWeek,
      `${d.toDateString()} labelled ${label} but week runs ${range.start.toDateString()} +7d`,
    );
    // And the range's own label must agree (stable round-trip).
    assert.equal(range.weekLabel, label, `round-trip drifted for ${d.toDateString()}`);
  }
});

test("consecutive Sundays increment the week number by exactly one", () => {
  const year = 2026;
  // First Sunday of the year.
  const jan1 = new Date(year, 0, 1);
  const sunday = new Date(year, 0, 1 + ((7 - jan1.getDay()) % 7));
  let prev = weekNumber(sunday);
  for (let i = 0; i < 50; i++) {
    sunday.setDate(sunday.getDate() + 7);
    if (sunday.getFullYear() !== year) break;
    const wk = weekNumber(sunday);
    assert.equal(wk, prev + 1, `week jumped at ${sunday.toDateString()}`);
    prev = wk;
  }
});

test("week 1 contains Jan 1, even when Jan 1 is mid-week", () => {
  assert.equal(weekNumber(new Date(2026, 0, 1)), 1); // Thursday
  assert.equal(weekNumber(new Date(2026, 0, 3)), 1); // Saturday
  assert.equal(weekNumber(new Date(2026, 0, 4)), 2); // first Sunday after
  assert.equal(weekLabel(new Date(2026, 0, 4)), "W02");
});

// ─── dueStatus (F4) ──────────────────────────────────────────────────
// The one shared "is this date past?" comparison — every surface that
// renders a dueDate routes through it, so the semantics live here:
// the due day itself is due_soon (still winnable), not overdue.

test("dueStatus classifies overdue / due_soon / ok around a fixed now", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  assert.equal(dueStatus("2026-08-31", now).state, "overdue");
  assert.equal(dueStatus("2026-08-31", now).days, -1);
  assert.equal(dueStatus("2026-09-01", now).state, "due_soon"); // today
  assert.equal(dueStatus("2026-09-01", now).days, 0);
  assert.equal(dueStatus("2026-09-08", now).state, "due_soon"); // 7 days out
  assert.equal(dueStatus("2026-09-09", now).state, "ok"); // 8 days out
});

test("dueStatus returns null for empty or malformed input", () => {
  assert.equal(dueStatus(""), null);
  assert.equal(dueStatus(null), null);
  assert.equal(dueStatus("09/01/2026"), null);
  assert.equal(dueStatus("not-a-date"), null);
});
