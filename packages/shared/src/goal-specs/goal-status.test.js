import test from "node:test";
import assert from "node:assert/strict";

import { buildCycleWindows } from "./windows.js";
import {
  GOAL_STATUS,
  STATUS_META,
  countStatuses,
  goalStatus,
  loggedSoFar,
  objectiveStatus,
  quietWindows,
} from "./goal-status.js";

const day = (iso) => Date.parse(`${iso}T00:00:00Z`);
const noon = (iso) => Date.parse(`${iso}T12:00:00Z`);
const NOW = noon("2026-09-29"); // Tuesday of W40 (Sep 27 – Oct 3)

function weekly({ entries = [], trackingStart, lockedKeys } = {}) {
  return buildCycleWindows({ entries, cadence: "weekly", now: NOW, trackingStart, lockedKeys });
}
const entry = (iso) => ({ ts: noon(iso), value: 1 });

/* ── one label / tint / sentence per state ──────────────────────────── */

test("every state has exactly one label, tint and description", () => {
  const labels = new Set();
  for (const key of new Set(Object.values(GOAL_STATUS))) {
    const m = STATUS_META[key];
    assert.ok(m, key);
    assert.ok(m.label && m.tone && m.description, key);
    labels.add(m.label);
  }
  assert.deepEqual(
    [...labels].sort(),
    ["Auto-tracked", "Behind", "Exceeding", "Needs setup", "No tracker yet", "Not logged", "On pace"],
  );
  assert.equal(STATUS_META[GOAL_STATUS.BEHIND].tone, "peach");
  assert.equal(STATUS_META[GOAL_STATUS.ON_PACE].tone, "mint");
  assert.equal(STATUS_META[GOAL_STATUS.NOT_LOGGED].tone, "lemon");
});

/* ── goalStatus mapping ─────────────────────────────────────────────── */

test("no spec → No tracker yet; not ready → Needs setup", () => {
  assert.equal(goalStatus({ hasTracker: false }).status, GOAL_STATUS.UNCLASSIFIED);
  assert.equal(goalStatus({ hasTracker: false }).label, "No tracker yet");
  assert.equal(goalStatus({ hasTracker: true, ready: false }).status, GOAL_STATUS.NEEDS_SETUP);
});

test("auto goals read Auto-tracked unless graded", () => {
  assert.equal(goalStatus({ hasTracker: true, auto: true }).status, GOAL_STATUS.AUTO);
  assert.equal(goalStatus({ hasTracker: true, auto: true, tier: "not_achieved" }).status, GOAL_STATUS.BEHIND);
  assert.equal(goalStatus({ hasTracker: true, auto: true, tier: "role_model" }).status, GOAL_STATUS.EXCEEDING);
});

test("only this week unlogged is On pace, not Behind (the week isn't over)", () => {
  const trackingStart = day("2026-09-14"); // W38
  const cycle = weekly({ trackingStart, entries: [entry("2026-09-15"), entry("2026-09-22")] });
  const s = goalStatus({ hasTracker: true, cycle, cadence: "weekly" });
  assert.equal(s.status, GOAL_STATUS.ON_PACE);
  assert.deepEqual(s.logged, { done: 2, due: 2, owed: 0 });
});

test("a missed due week is Behind with a reason; 2+ in a row is 'Gone quiet'", () => {
  const trackingStart = day("2026-09-01");
  const one = goalStatus({
    hasTracker: true,
    cadence: "weekly",
    cycle: weekly({ trackingStart, entries: [entry("2026-09-02"), entry("2026-09-09"), entry("2026-09-23")] }),
  });
  assert.equal(one.status, GOAL_STATUS.BEHIND);
  assert.equal(one.reason, "1 week missed");
  assert.equal(one.quiet, 0);

  const quiet = goalStatus({
    hasTracker: true,
    cadence: "weekly",
    cycle: weekly({ trackingStart, entries: [entry("2026-09-02")] }),
  });
  assert.equal(quiet.status, GOAL_STATUS.BEHIND);
  assert.equal(quiet.quiet, 3);
  assert.match(quiet.reason, /^Gone quiet · 3 weeks/);
});

test("a settled ('nothing to report') week is not a miss", () => {
  const trackingStart = day("2026-09-14");
  const cycle = weekly({
    trackingStart,
    entries: [entry("2026-09-15")],
    lockedKeys: new Set(["2026-W39"]),
  });
  assert.equal(goalStatus({ hasTracker: true, cycle }).status, GOAL_STATUS.ON_PACE);
});

test("a fresh tracker with nothing due yet is Not logged", () => {
  const cycle = weekly({ trackingStart: day("2026-09-28") });
  const s = goalStatus({ hasTracker: true, cycle });
  assert.equal(s.status, GOAL_STATUS.NOT_LOGGED);
  assert.deepEqual(s.logged, { done: 0, due: 0, owed: 0 });
});

test("a grade outranks the log: Exceeding wins, Not achieved reads Behind", () => {
  const cycle = weekly({ trackingStart: day("2026-09-14"), entries: [entry("2026-09-15"), entry("2026-09-22")] });
  assert.equal(goalStatus({ hasTracker: true, cycle, tier: "over_achieved" }).status, GOAL_STATUS.EXCEEDING);
  const na = goalStatus({ hasTracker: true, cycle, tier: "not_achieved" });
  assert.equal(na.status, GOAL_STATUS.BEHIND);
  assert.equal(na.reason, "Graded Not achieved");
});

test("non-windowed goals: data → On pace, none → Not logged", () => {
  const pip = buildCycleWindows({ entries: [], cadence: null, now: NOW });
  assert.equal(goalStatus({ hasTracker: true, cycle: pip }).status, GOAL_STATUS.NOT_LOGGED);
  assert.equal(goalStatus({ hasTracker: true, cycle: pip, hasData: true }).status, GOAL_STATUS.ON_PACE);
});

/* ── due-so-far counts ──────────────────────────────────────────────── */

test("'N of M logged' counts only windows due so far — never future or pre-tracker weeks", () => {
  // Tracker started W35 (Aug 23). Due so far: W35–W39 = 5 weeks. The
  // cycle has 53 windows; the old denominator was `total` (19 here).
  const cycle = weekly({
    trackingStart: day("2026-08-24"),
    entries: [entry("2026-08-25"), entry("2026-09-01"), entry("2026-09-15"), entry("2026-09-22")],
  });
  assert.ok(cycle.total > 5);
  assert.deepEqual(loggedSoFar(cycle), { done: 4, due: 5, owed: 1 });
});

test("logging the current week early counts as done and due; logging ahead doesn't", () => {
  const cycle = weekly({
    trackingStart: day("2026-09-14"),
    entries: [entry("2026-09-15"), entry("2026-09-22"), entry("2026-09-28"), entry("2026-10-06")],
  });
  assert.deepEqual(loggedSoFar(cycle), { done: 3, due: 3, owed: 0 });
});

test("quietWindows walks back from the last ended window", () => {
  const cycle = weekly({ trackingStart: day("2026-09-01"), entries: [entry("2026-09-02")] });
  assert.equal(quietWindows(cycle), 3);
  assert.equal(loggedSoFar(null), null);
});

/* ── objective roll-up ──────────────────────────────────────────────── */

test("an objective takes its worst MEASURED child", () => {
  const S = GOAL_STATUS;
  assert.equal(objectiveStatus([S.ON_PACE, S.UNCLASSIFIED, S.NEEDS_SETUP]), S.ON_PACE);
  assert.equal(objectiveStatus([S.ON_PACE, S.BEHIND, S.AUTO]), S.BEHIND);
  assert.equal(objectiveStatus([S.UNCLASSIFIED, S.NEEDS_SETUP]), S.NEEDS_SETUP);
  assert.equal(objectiveStatus([]), null);
});

test("countStatuses orders worst first and carries the shared labels", () => {
  const S = GOAL_STATUS;
  const c = countStatuses([S.ON_PACE, S.BEHIND, S.ON_PACE]);
  assert.deepEqual(c.map((x) => [x.label, x.count]), [["Behind", 1], ["On pace", 2]]);
});
