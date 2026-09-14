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

test("weekly: 13 windows from a Tuesday start end the day before week 14", () => {
  assert.equal(cycleEndForCount("2026-09-01", "weekly", 13), "2026-11-30");
  assert.equal(windowCountForCycle("2026-09-01", "weekly", "2026-11-30"), 13);
});

test("daily and biweekly strides", () => {
  assert.equal(cycleEndForCount("2026-09-01", "daily", 1), "2026-09-01");
  assert.equal(cycleEndForCount("2026-09-01", "daily", 10), "2026-09-10");
  assert.equal(cycleEndForCount("2026-09-01", "biweekly", 3), "2026-10-12");
  assert.equal(windowCountForCycle("2026-09-01", "biweekly", "2026-10-12"), 3);
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
  // 10 days on a weekly cadence = 2 windows (the second is 3 days long).
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
  assert.equal(snapCycleStart("weekly", wed), "2026-09-14");
  assert.equal(snapCycleStart("biweekly", wed), "2026-09-14");
  assert.equal(snapCycleStart("daily", wed), "2026-09-16");
  assert.equal(snapCycleStart("monthly", wed), "2026-09-01");
  assert.equal(snapCycleStart("quarterly", wed), "2026-07-01");
  // A Monday stays put.
  assert.equal(snapCycleStart("weekly", Date.UTC(2026, 8, 14)), "2026-09-14");
});
