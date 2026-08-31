import test from "node:test";
import assert from "node:assert/strict";

import { weekLabel, weekNumber, weekRangeFromLabel } from "./date.js";

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
