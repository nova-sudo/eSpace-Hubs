import test from "node:test";
import assert from "node:assert/strict";

import { buildCycleWindows, currentPeriodKey, composedCycleBounds } from "./cadence-windows.js";

/**
 * Regression cover for cycle-bounded calendar windows.
 *
 * The monthly/quarterly branches of `enumerateWindows` used to ignore the
 * `cycleStart`/`cycleEnd` arguments entirely and always tile Jan–Dec of the
 * calendar year containing `now`. That made any cycle not starting in January
 * — e.g. a 6-month IDP running Aug–Jan, the exact shape of a real imported
 * growth-goal sheet — silently unrepresentable: callers got 12 wrong windows
 * back and no error.
 *
 * The two things these tests pin down:
 *   1. Default (no explicit bounds) output is UNCHANGED, element for element —
 *      `key` values are persisted as goal-input periodKeys, so drifting them
 *      would orphan already-logged entries.
 *   2. Explicit bounds are actually honoured, including across a year boundary.
 */

const JAN_2026 = Date.UTC(2026, 0, 1);
const JAN_2027 = Date.UTC(2027, 0, 1);
/** Mid-cycle instant used as `now` where the assertion doesn't depend on it. */
const NOW_MID_2026 = Date.UTC(2026, 5, 15);

function keysOf(cycle) {
  return cycle.windows.map((w) => w.key);
}
function labelsOf(cycle) {
  return cycle.windows.map((w) => w.label);
}

test("monthly with default bounds still tiles the full calendar year", () => {
  const cycle = buildCycleWindows({
    entries: [],
    cadence: "monthly",
    now: NOW_MID_2026,
  });
  assert.equal(cycle.mode, "stepper");
  assert.equal(cycle.total, 12);
  assert.deepEqual(keysOf(cycle), [
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
    "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
  ]);
  // Single-year cycle keeps bare month labels (no year suffix).
  assert.deepEqual(labelsOf(cycle).slice(0, 3), ["Jan", "Feb", "Mar"]);
});

test("quarterly with default bounds still tiles the full calendar year", () => {
  const cycle = buildCycleWindows({
    entries: [],
    cadence: "quarterly",
    now: NOW_MID_2026,
  });
  assert.equal(cycle.total, 4);
  assert.deepEqual(keysOf(cycle), ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"]);
  assert.deepEqual(labelsOf(cycle), ["Q1", "Q2", "Q3", "Q4"]);
});

test("explicit full-year bounds match the implicit default exactly", () => {
  const implicit = buildCycleWindows({
    entries: [],
    cadence: "monthly",
    now: NOW_MID_2026,
  });
  const explicit = buildCycleWindows({
    entries: [],
    cadence: "monthly",
    now: NOW_MID_2026,
    cycleStart: JAN_2026,
    cycleEnd: JAN_2027,
  });
  assert.deepEqual(explicit.windows, implicit.windows);
});

test("monthly honours a 6-month cycle that starts mid-year and crosses into the next", () => {
  // Aug 2026 → Feb 2027 (exclusive end): the real 6-month IDP shape.
  const cycle = buildCycleWindows({
    entries: [],
    cadence: "monthly",
    now: Date.UTC(2026, 8, 10),
    cycleStart: Date.UTC(2026, 7, 1),
    cycleEnd: Date.UTC(2027, 1, 1),
  });
  assert.equal(cycle.total, 6, "six monthly checkpoints, not twelve");
  assert.deepEqual(keysOf(cycle), [
    "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01",
  ]);
  // Crossing a year boundary disambiguates labels so two Januaries can't collide.
  assert.deepEqual(labelsOf(cycle), [
    "Aug 26", "Sep 26", "Oct 26", "Nov 26", "Dec 26", "Jan 27",
  ]);
});

test("quarterly honours bounds and snaps a mid-quarter start back to the quarter boundary", () => {
  // Starts 14 Feb (inside Q1) — the window must still begin 1 Jan so the key
  // stays "2026-Q1" and lines up with currentPeriodKey.
  const cycle = buildCycleWindows({
    entries: [],
    cadence: "quarterly",
    now: Date.UTC(2026, 3, 1),
    cycleStart: Date.UTC(2026, 1, 14),
    cycleEnd: Date.UTC(2026, 9, 1),
  });
  assert.deepEqual(keysOf(cycle), ["2026-Q1", "2026-Q2", "2026-Q3"]);
  assert.equal(cycle.windows[0].start, Date.UTC(2026, 0, 1));
});

test("cycle-bounded windows still classify state from now and entries", () => {
  const cycle = buildCycleWindows({
    entries: [{ ts: Date.UTC(2026, 7, 12) }],
    cadence: "monthly",
    now: Date.UTC(2026, 9, 5),
    cycleStart: Date.UTC(2026, 7, 1),
    cycleEnd: Date.UTC(2027, 1, 1),
  });
  const byKey = Object.fromEntries(cycle.windows.map((w) => [w.key, w.state]));
  assert.equal(byKey["2026-08"], "filled", "has an entry");
  assert.equal(byKey["2026-09"], "owed", "elapsed with no entry");
  assert.equal(byKey["2026-10"], "current", "contains now");
  assert.equal(byKey["2026-11"], "future");
  assert.equal(cycle.filledCount, 1);
  assert.equal(cycle.currentIndex, 2);
});

test("currentPeriodKey agrees with the key of the window containing now", () => {
  const now = Date.UTC(2026, 9, 5);
  for (const cadence of ["monthly", "quarterly"]) {
    const cycle = buildCycleWindows({ entries: [], cadence, now });
    const current = cycle.windows.find((w) => now >= w.start && now < w.end);
    assert.equal(
      currentPeriodKey(cadence, now),
      current.key,
      `${cadence} periodKey must match the stepper cell the user clicks`,
    );
  }
});

test("weekly bounds still honoured and unaffected by the calendar-branch change", () => {
  const cycle = buildCycleWindows({
    entries: [],
    cadence: "weekly",
    now: Date.UTC(2026, 0, 15),
    cycleStart: JAN_2026,
    cycleEnd: Date.UTC(2026, 0, 29), // exactly 4 weeks
  });
  assert.equal(cycle.total, 4);
  assert.deepEqual(labelsOf(cycle), ["W1", "W2", "W3", "W4"]);
});

/**
 * Regression cover for a real reported bug: a 13-week plan (composed.periods)
 * that doesn't start January 1 rendered "week 13" against the calendar year
 * instead of the plan's own week 13, because buildCycleWindows/currentPeriodKey
 * always defaulted cycleStart to Jan 1 of `now`'s year — composedCycleBounds
 * is the fix, reading the pair the spec now optionally carries.
 */
test("composedCycleBounds reads a valid ISO pair off composed.cycleStart/cycleEnd", () => {
  const spec = { composed: { cadence: "weekly", cycleStart: "2026-09-01", cycleEnd: "2026-11-30" } };
  const bounds = composedCycleBounds(spec);
  assert.equal(bounds.cycleStart, Date.UTC(2026, 8, 1));
  // Exclusive end = the day AFTER the stored (inclusive) last day.
  assert.equal(bounds.cycleEnd, Date.UTC(2026, 10, 30) + 86_400_000);
});

test("composedCycleBounds returns {} for an absent, malformed, or inverted pair", () => {
  assert.deepEqual(composedCycleBounds({}), {});
  assert.deepEqual(composedCycleBounds({ composed: { cadence: "weekly" } }), {});
  assert.deepEqual(
    composedCycleBounds({ composed: { cycleStart: "2026-09-01" } }),
    {},
    "cycleEnd missing",
  );
  assert.deepEqual(
    composedCycleBounds({ composed: { cycleStart: "not-a-date", cycleEnd: "2026-11-30" } }),
    {},
  );
  assert.deepEqual(
    composedCycleBounds({ composed: { cycleStart: "2026-11-30", cycleEnd: "2026-09-01" } }),
    {},
    "end before start",
  );
});

test("a weekly plan anchored to composedCycleBounds numbers week 1 from ITS OWN start, not Jan 1", () => {
  const spec = { composed: { cadence: "weekly", cycleStart: "2026-09-07", cycleEnd: "2026-11-29" } };
  const bounds = composedCycleBounds(spec);
  const now = Date.UTC(2026, 8, 10); // a few days into the plan's actual week 1
  const cycle = buildCycleWindows({ entries: [], cadence: "weekly", now, ...bounds });
  assert.deepEqual(labelsOf(cycle).slice(0, 3), ["W1", "W2", "W3"]);
  assert.equal(cycle.currentIndex, 0);

  // currentPeriodKey must agree with buildCycleWindows' own key for that same
  // window — without passing the bounds through, this used to compute "W2"
  // (the 2nd week counting from Jan 1 of that year) instead of "W1", so a
  // saved entry would never match any window the widget actually renders.
  const key = currentPeriodKey("weekly", now, bounds.cycleStart, bounds.cycleEnd);
  assert.equal(key, cycle.windows[0].key);
  assert.notEqual(
    currentPeriodKey("weekly", now),
    key,
    "sanity check: the un-anchored default really does disagree",
  );
});
