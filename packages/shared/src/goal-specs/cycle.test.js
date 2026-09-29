import test from "node:test";
import assert from "node:assert/strict";

import {
  CYCLE_MAX_WINDOWS,
  cycleEndForCount,
  snapCycleStart,
  windowCountForCycle,
} from "./cycle.js";

/**
 * The composer stamps `composed.cycleEnd` from a plan length ("13 weeks")
 * with these — a 13-week plan must come out as 13 windows, not the
 * calendar-year default of 53. Round-trips between the two functions are
 * pinned for every cadence so a length read back off a stored date pair is
 * the length that produced it.
 */

// Weekly grids are Sunday-anchored work weeks (Sun→Sat): a Tuesday start's
// first window is the clipped Tue–Sat stub of its week, and the 13th window
// ends on the Saturday 13 Sundays later — not cycleStart + 91 days (the old
// fixed-stride rule, which ran to Mon 30 Nov).
test("weekly: 13 windows from a Tuesday start end on the 13th week's Saturday", () => {
  assert.equal(cycleEndForCount("2026-09-01", "weekly", 13), "2026-11-28");
  assert.equal(windowCountForCycle("2026-09-01", "weekly", "2026-11-28"), 13);
  // A Sunday start is 13 whole weeks.
  assert.equal(cycleEndForCount("2026-08-30", "weekly", 13), "2026-11-28");
});

test("daily and biweekly strides", () => {
  assert.equal(cycleEndForCount("2026-09-01", "daily", 1), "2026-09-01");
  assert.equal(cycleEndForCount("2026-09-01", "daily", 10), "2026-09-10");
  // Biweekly pairs Sunday-weeks from the week containing the start (Sun 30 Aug).
  assert.equal(cycleEndForCount("2026-09-01", "biweekly", 3), "2026-10-10");
  assert.equal(windowCountForCycle("2026-09-01", "biweekly", "2026-10-10"), 3);
});

test("monthly snaps a mid-month start back to the 1st, then counts calendar months", () => {
  // Sept 15 → Sep, Oct, Nov, Dec, Jan, Feb → last day Feb 28 2027.
  assert.equal(cycleEndForCount("2026-09-15", "monthly", 6), "2027-02-28");
  assert.equal(windowCountForCycle("2026-09-15", "monthly", "2027-02-28"), 6);
});

test("quarterly snaps to the quarter's first month", () => {
  // Aug 2026 is in Q3 (Jul–Sep). 2 quarters → Q3 + Q4 → Dec 31.
  assert.equal(cycleEndForCount("2026-08-20", "quarterly", 2), "2026-12-31");
  assert.equal(windowCountForCycle("2026-08-20", "quarterly", "2026-12-31"), 2);
});

test("a partial trailing window still counts as a window", () => {
  // Tue 1 – Thu 10 Sep on a weekly cadence = 2 windows (Tue–Sat, Sun–Thu).
  assert.equal(windowCountForCycle("2026-09-01", "weekly", "2026-09-10"), 2);
});

test("rejects garbage rather than guessing", () => {
  assert.equal(cycleEndForCount("Sept 1", "weekly", 13), null);
  assert.equal(cycleEndForCount("2026-09-01", "fortnightly", 13), null);
  assert.equal(cycleEndForCount("2026-09-01", "weekly", 0), null);
  assert.equal(cycleEndForCount("2026-09-01", "weekly", CYCLE_MAX_WINDOWS + 1), null);
  assert.equal(cycleEndForCount("2026-09-01", "weekly", 1.5), null);
  assert.equal(windowCountForCycle("2026-09-01", "weekly", "2026-08-01"), null);
  assert.equal(windowCountForCycle("2026-09-01", "weekly", "soon"), null);
});

test("snapCycleStart lands on the period's first day", () => {
  const wed = Date.UTC(2026, 8, 16); // Wednesday 16 Sep 2026
  // Weekly plans start on the Sunday that opens the work week.
  assert.equal(snapCycleStart("weekly", wed), "2026-09-13");
  assert.equal(snapCycleStart("biweekly", wed), "2026-09-13");
  assert.equal(snapCycleStart("daily", wed), "2026-09-16");
  assert.equal(snapCycleStart("monthly", wed), "2026-09-01");
  assert.equal(snapCycleStart("quarterly", wed), "2026-07-01");
  // A Sunday stays put.
  assert.equal(snapCycleStart("weekly", Date.UTC(2026, 8, 13)), "2026-09-13");
});
