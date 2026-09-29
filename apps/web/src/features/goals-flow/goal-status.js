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
  goalStatus,
  loggedPercent,
  objectiveProgress,
  objectiveStatus,
  weightedProgress as weightedProgressCanonical,
  countStatuses,
} from "@/features/goal-inputs";
import { readLocks } from "@/features/goal-locks";
import { isContextComplete } from "@/features/goal-context";
import { readCappedGoalTier, numericReadingFor } from "@/features/goal-tiers";
import { SPEC_KINDS, SPEC_KIND_META, SPEC_VARIANTS } from "@/features/goal-specs";
import { isGoalReady } from "@/features/goal-widgets";
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
/**
 * A checklist's done ÷ total, from its latest snapshot — or null when this
 * isn't a checklist goal / nothing is logged. Recurring checklists reset per
 * period, so the latest entry is still the honest read for "right now".
 */
function checklistFraction(spec, entries) {
  const kind = spec?.widget;
  if (kind !== SPEC_KINDS.MILESTONE && kind !== SPEC_KINDS.RECURRING_MILESTONE) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const items = entries[i]?.value?.items;
    if (Array.isArray(items) && items.length > 0) {
      return items.filter((it) => it && it.done).length / items.length;
    }
  }
  return null;
}

function progressPercent(spec, entries, goal) {
  // "Logged so far" is canonical — the same number Home and Evidence show.
  // Only a goal with no window model AND no checklist falls back to reading
  // its value against the achieved threshold (a ratio with no equivalent
  // elsewhere, so it stays local).
  const fraction = checklistFraction(spec, entries);
  const canonical = loggedPercent({
    goal,
    hasData: entries.length > 0,
    ...(fraction != null ? { fraction } : {}),
  });
  if (goal?.logged || fraction != null) return canonical;
  if (goal && goal.status !== GOAL_STATUS.ON_PACE && goal.status !== GOAL_STATUS.BEHIND) {
    return canonical;
  }
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
 * `{ status, tone, label, description, reason, logged, tier, cyc, pct, owed }`
 * for one goal — the shared `goalStatus` (goal-inputs), fed from this page's
 * stores: the cadence windows with locks applied and the capped tier.
 */
export function goalStatusFor(goalId, spec) {
  if (!goalId || !spec) {
    return {
      ...goalStatus({ hasTracker: false }),
      tier: null,
      cyc: null,
      pct: null,
      owed: false,
    };
  }

  const entries = readGoalEntries(goalId);

  // A goal that can't be logged yet — awaiting approval, delegated, needs
  // its setup questions, untrackable — is not "behind"; it needs setup.
  if (!isGoalReady(spec, isContextComplete(spec))) {
    return {
      ...goalStatus({ hasTracker: true, ready: false }),
      tier: null,
      cyc: null,
      pct: null,
      owed: false,
    };
  }

  const verdict = readCappedGoalTier(goalId, spec, entries, lockedKeysFor(goalId), null);
  const tier = verdict?.tier || null;

  // AUTO widgets read from the code hosts — there is nothing to log.
  const auto =
    SPEC_KIND_META[spec.widget]?.variant === SPEC_VARIANTS.AUTO && spec.kind !== SPEC_VARIANTS.HYBRID;
  const cyc = auto ? null : cadenceWindowsFor(goalId, spec);
  const goal = goalStatus({
    hasTracker: true,
    auto,
    cycle: cyc,
    hasData: entries.length > 0,
    tier,
    cadence: cyc?.cadence ?? null,
  });
  const owed = goal.logged ? goal.logged.owed > 0 : false;
  const pct = auto ? null : progressPercent(spec, entries, goal);
  return { ...goal, tier, cyc, pct, expected: pct == null ? null : 100, owed };
}

/** The dot color for a goal's tier on a plain surface — the tint's `-text`
 *  token, or muted when ungraded. */
export function tierDotColor(tier) {
  return tierColor(tier) || "var(--muted-fg)";
}

/**
 * Rollup for one objective: the mean of its goals' "logged so far" (the
 * ring's number) plus its weakest MEASURED child's status (the tile's badge)
 * — the same `objectiveStatus` rule Home, Evidence and the manager use.
 */
export function objectiveRollup(statuses) {
  const list = statuses || [];
  // null, not 0, when nothing under the objective is measurable — an
  // auto-tracked objective is not a failed one.
  const pct = objectiveProgress(list.map((s) => s.pct));
  const worstKey = objectiveStatus(list.map((s) => s.status)) || GOAL_STATUS.UNCLASSIFIED;
  return { pct, expected: pct == null ? null : 100, status: worstKey, ...STATUS_META[worstKey] };
}

/**
 * Weighted "logged so far" across the whole tree — each objective's rolled-up
 * percentage times its weight. Falls back to a flat average when
 * the imported tree carries no weightages.
 */
export function weightedProgress(rows) {
  return weightedProgressCanonical(rows);
}

/** `{ status, count, tone, label }` over every goal, worst first. */
export function statusCounts(statuses) {
  return countStatuses((statuses || []).map((s) => s.status));
}
