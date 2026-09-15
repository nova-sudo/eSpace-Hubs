"use client";

/**
 * One status word per goal, and the objective rollup built out of it.
 *
 * Nothing here is new state: the status is READ from what the app already
 * decides elsewhere — the cadence windows (`cadenceWindowsFor`, which is
 * `buildCycleWindows` with this goal's locks applied) and the capped tier
 * verdict (`readCappedGoalTier`, the same number the tier badge shows). The
 * board columns, the tile badges and the summary counts are all projections
 * of those two, so a goal can never read "behind" in one view and "on pace"
 * in another.
 *
 * Reads the stores synchronously rather than through hooks, for the same
 * reason `flow-row-meta` does: the page has to rank, filter and count every
 * goal before any per-goal component mounts. Callers re-run these keyed on
 * the `useAllGoalInputs()` / `useGoalLocks()` / goal-tier store ticks.
 */

import {
  readGoalEntries,
  GOAL_STATUS,
  STATUS_META,
  goalProgress,
  objectiveProgress,
  weightedProgress as weightedProgressCanonical,
  worstStatus,
  countStatuses,
} from "@/features/goal-inputs";
import { readLocks } from "@/features/goal-locks";
import { readCappedGoalTier, numericReadingFor } from "@/features/goal-tiers";
import { cadenceWindowsFor, tierColor } from "./flow-row-meta";

// The status vocabulary, the severity order and the roll-up maths are
// canonical in `goal-inputs/goal-progress` — this file only decides WHICH
// status a goal is in, from the cadence windows and the capped tier. Two
// surfaces each owning a copy is exactly how the Goals and Intelligence
// pages came to print different numbers for the same cycle.
export { GOAL_STATUS, STATUS_META };

/** The board's four columns, left to right. */
export const BOARD_COLUMNS = Object.freeze([
  GOAL_STATUS.NOT_LOGGED,
  GOAL_STATUS.BEHIND,
  GOAL_STATUS.ON_PACE,
  GOAL_STATUS.EXCEEDING,
]);

function lockedKeysFor(goalId) {
  const prefix = `${goalId}::`;
  const all = readLocks();
  const keys = new Set();
  for (const k of Object.keys(all)) {
    if (all[k] && k.startsWith(prefix)) keys.add(k.slice(prefix.length));
  }
  return keys;
}

function clampPercent(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * How far through this goal we are, 0–100, or null when the goal has no
 * honest number to give (a qualitative tracker with no ladder scale). A
 * cadenced goal counts its logged windows; a numeric one is measured against
 * its own "achieved" threshold, which is the only target the app stores.
 */
function progressPercent(spec, entries, cyc, status) {
  // The cadence-window share is canonical. Only when a goal has no window
  // model at all do we fall back to reading its value against the achieved
  // threshold — a ratio the Intelligence page has no equivalent for, so it
  // stays local rather than being promoted.
  const canonical = goalProgress({ status, cycle: cyc, hasData: entries.length > 0 });
  if (cyc && cyc.total > 0) return canonical;
  const scale = spec?.tierScale;
  const achieved = scale?.achieved;
  if (!scale || !Number.isFinite(achieved)) return canonical;
  const reading = numericReadingFor(spec, entries, null);
  if (!reading || !Number.isFinite(reading.value)) return canonical;
  if (scale.direction === "lower") {
    if (reading.value <= 0) return 100;
    return clampPercent((achieved / reading.value) * 100);
  }
  if (achieved <= 0) return canonical;
  return clampPercent((reading.value / achieved) * 100);
}

/**
 * `{ status, tone, label, tier, cyc, pct, owed }` for one goal.
 * An unclassified goal (no spec) has no tracker at all, so it reports
 * `unclassified` and nothing else.
 */
export function goalStatusFor(goalId, spec) {
  if (!goalId || !spec) {
    return {
      status: GOAL_STATUS.UNCLASSIFIED,
      ...STATUS_META[GOAL_STATUS.UNCLASSIFIED],
      tier: null,
      cyc: null,
      pct: null,
      owed: false,
    };
  }

  const entries = readGoalEntries(goalId);
  const verdict = readCappedGoalTier(goalId, spec, entries, lockedKeysFor(goalId), null);
  const tier = verdict?.tier || null;
  const cyc = cadenceWindowsFor(goalId, spec);
  const owed = cyc ? (cyc.windows || []).some((w) => w.state === "owed") : false;

  let status;
  if (tier === "over_achieved" || tier === "role_model") {
    status = GOAL_STATUS.EXCEEDING;
  } else if (cyc) {
    if (owed) status = GOAL_STATUS.BEHIND;
    else if (cyc.filledCount === 0) status = GOAL_STATUS.NOT_LOGGED;
    else status = GOAL_STATUS.ON_PACE;
  } else if (tier === "not_achieved") {
    status = GOAL_STATUS.BEHIND;
  } else if (tier) {
    status = GOAL_STATUS.ON_PACE;
  } else if (entries.length > 0) {
    status = GOAL_STATUS.ON_PACE;
  } else {
    status = GOAL_STATUS.NOT_LOGGED;
  }

  const pct = progressPercent(spec, entries, cyc, status);
  return { status, ...STATUS_META[status], tier, cyc, pct, owed };
}

/** The dot color for a goal's tier — the tint's ink, or dim when ungraded. */
export function tierDotColor(tier) {
  return tierColor(tier) || "var(--dim-fg)";
}

/**
 * Rollup for one objective: the average of its goals' progress (the ring's
 * number) plus its weakest child's status (the tile's badge).
 */
export function objectiveRollup(statuses) {
  const list = statuses || [];
  // null, not 0, when nothing under the objective is measurable — an
  // auto-tracked objective is not a failed one.
  const pct = objectiveProgress(list.map((s) => s.pct));
  const worstKey = worstStatus(list.map((s) => s.status)) || GOAL_STATUS.UNCLASSIFIED;
  return { pct, status: worstKey, ...STATUS_META[worstKey] };
}

/**
 * Weighted progress across the whole cycle — each objective's rolled-up
 * percentage times its share of the year. Falls back to a flat average when
 * the imported tree carries no weightages.
 */
export function weightedProgress(rows) {
  return weightedProgressCanonical(rows);
}

/** `{ status, count, tone, label }` over every goal, worst first. */
export function statusCounts(statuses) {
  return countStatuses((statuses || []).map((s) => s.status));
}
