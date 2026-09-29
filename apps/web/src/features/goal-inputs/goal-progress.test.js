import test from "node:test";
import assert from "node:assert/strict";

import {
  GOAL_STATUS,
  STATUS_META,
  goalStatus,
  loggedPercent,
  loggedTotals,
  unmeasuredLine,
  weightedProgress,
  objectiveProgress,
} from "./goal-progress.js";
import { buildCycleWindows } from "@espace-devhub/shared/goal-specs";

const day = (iso) => Date.parse(`${iso}T00:00:00Z`);
const noon = (iso) => Date.parse(`${iso}T12:00:00Z`);
const NOW = noon("2026-09-29");
const weekly = (entries, trackingStart) =>
  buildCycleWindows({ entries: entries.map((d) => ({ ts: noon(d), value: 1 })), cadence: "weekly", now: NOW, trackingStart });

test("goal-inputs re-exports the ONE shared vocabulary", () => {
  assert.equal(STATUS_META[GOAL_STATUS.UNCLASSIFIED].label, "No tracker yet");
  assert.equal(STATUS_META[GOAL_STATUS.AUTO].tone, "lav");
});

test("loggedPercent is logged ÷ DUE so far — future and pre-tracker weeks never count", () => {
  // Tracker from W35; W35–W39 due; 4 of them logged → 80%, not 4/19.
  const goal = goalStatus({
    hasTracker: true,
    cycle: weekly(["2026-08-25", "2026-09-01", "2026-09-15", "2026-09-22"], day("2026-08-24")),
  });
  assert.equal(goal.status, GOAL_STATUS.BEHIND);
  assert.equal(loggedPercent({ goal }), 80);
});

test("nothing due yet / unmeasured goals stay out of the number (null, not 0)", () => {
  const fresh = goalStatus({ hasTracker: true, cycle: weekly([], day("2026-09-28")) });
  assert.equal(loggedPercent({ goal: fresh }), null);
  assert.equal(loggedPercent({ goal: goalStatus({ hasTracker: false }) }), null);
  assert.equal(loggedPercent({ goal: goalStatus({ hasTracker: true, auto: true }) }), null);
  assert.equal(loggedPercent({ goal: goalStatus({ hasTracker: true, ready: false }) }), null);
});

test("non-windowed goals: a checklist states its fraction; data counts as done", () => {
  const pip = buildCycleWindows({ entries: [], cadence: null, now: NOW });
  const goal = goalStatus({ hasTracker: true, cycle: pip, hasData: true });
  assert.equal(loggedPercent({ goal, fraction: 0.5 }), 50);
  assert.equal(loggedPercent({ goal, hasData: true }), 100);
});

test("loggedTotals sums due-so-far over measured goals; headline weights objectives", () => {
  const a = goalStatus({ hasTracker: true, cycle: weekly(["2026-09-15", "2026-09-22"], day("2026-09-14")) });
  const b = goalStatus({ hasTracker: true, cycle: weekly(["2026-09-15"], day("2026-09-14")) });
  assert.deepEqual(loggedTotals([a, b, goalStatus({ hasTracker: false })]), { done: 3, due: 4 });
  const pa = loggedPercent({ goal: a });
  const pb = loggedPercent({ goal: b });
  assert.equal(pa, 100);
  assert.equal(pb, 50);
  assert.equal(weightedProgress([{ pct: objectiveProgress([pa]), weight: 30 }, { pct: pb, weight: 10 }]), 88);
});

test("unmeasuredLine names what isn't in the number", () => {
  assert.equal(unmeasuredLine(0), null);
  assert.equal(unmeasuredLine(10), "10 goals aren't measured yet — they're not in this number.");
  assert.match(unmeasuredLine(1), /^1 goal isn't/);
});
