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

import { readGoalEntries } from "@/features/goal-inputs";
import { readLocks } from "@/features/goal-locks";
import { readCappedGoalTier, numericReadingFor } from "@/features/goal-tiers";
import { cadenceWindowsFor, tierColor } from "./flow-row-meta";

export const GOAL_STATUS = Object.freeze({
  UNCLASSIFIED: "unclassified",
  NOT_LOGGED: "not-logged",
  BEHIND: "behind",
  ON_PACE: "on-pace",
  EXCEEDING: "exceeding",
});

/** Tone + wording for each status. The tone is the Badge/Card tint name. */
export const STATUS_META = Object.freeze({
  [GOAL_STATUS.UNCLASSIFIED]: { tone: "neutral", label: "Unclassified" },
  [GOAL_STATUS.NOT_LOGGED]: { tone: "lemon", label: "Not logged" },
  [GOAL_STATUS.BEHIND]: { tone: "peach", label: "Behind" },
  [GOAL_STATUS.ON_PACE]: { tone: "mint", label: "On pace" },
  [GOAL_STATUS.EXCEEDING]: { tone: "sky", label: "Exceeding" },
});

/** The board's four columns, left to right. */
export const BOARD_COLUMNS = Object.freeze([
  GOAL_STATUS.NOT_LOGGED,
  GOAL_STATUS.BEHIND,
  GOAL_STATUS.ON_PACE,
  GOAL_STATUS.EXCEEDING,
]);

/** Order used for the summary row's badges, and to pick an objective's
 *  worst child — Perdoo's rule: a parent's NUMBER is an average but its
 *  STATUS is its weakest child. Worst first. */
const SEVERITY = [
  GOAL_STATUS.BEHIND,
  GOAL_STATUS.NOT_LOGGED,
  GOAL_STATUS.UNCLASSIFIED,
  GOAL_STATUS.ON_PACE,
  GOAL_STATUS.EXCEEDING,
];


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
function progressPercent(spec, entries, cyc) {
  if (cyc && cyc.total > 0) return clampPercent((cyc.filledCount / cyc.total) * 100);
  const scale = spec?.tierScale;
  const achieved = scale?.achieved;
  if (!scale || !Number.isFinite(achieved)) return null;
  const reading = numericReadingFor(spec, entries, null);
  if (!reading || !Number.isFinite(reading.value)) return null;
  if (scale.direction === "lower") {
    if (reading.value <= 0) return 100;
    return clampPercent((achieved / reading.value) * 100);
  }
  if (achieved <= 0) return null;
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
  const pct = progressPercent(spec, entries, cyc);
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
  const pcts = list.map((s) => s.pct).filter((p) => p != null);
  const pct = pcts.length > 0 ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
  const worst =
    [...list].sort(
      (a, b) => SEVERITY.indexOf(a.status) - SEVERITY.indexOf(b.status),
    )[0] || null;
  return {
    pct,
    status: worst?.status || GOAL_STATUS.UNCLASSIFIED,
    tone: worst?.tone || STATUS_META[GOAL_STATUS.UNCLASSIFIED].tone,
    label: worst?.label || STATUS_META[GOAL_STATUS.UNCLASSIFIED].label,
  };
}

/**
 * Weighted progress across the whole cycle — each objective's rolled-up
 * percentage times its share of the year. Falls back to a flat average when
 * the imported tree carries no weightages.
 */
export function weightedProgress(rows) {
  const list = (rows || []).filter((r) => r && Number.isFinite(r.pct));
  if (list.length === 0) return 0;
  const weighted = list.filter((r) => Number.isFinite(r.weight) && r.weight > 0);
  const totalWeight = weighted.reduce((s, r) => s + r.weight, 0);
  if (weighted.length > 0 && totalWeight > 0) {
    return Math.round(weighted.reduce((s, r) => s + r.pct * r.weight, 0) / totalWeight);
  }
  return Math.round(list.reduce((s, r) => s + r.pct, 0) / list.length);
}

/** `{ status: count }` over every goal, in worst-first order. */
export function statusCounts(statuses) {
  const counts = new Map();
  for (const s of statuses || []) {
    counts.set(s.status, (counts.get(s.status) || 0) + 1);
  }
  return SEVERITY.filter((k) => counts.get(k) > 0).map((k) => ({
    status: k,
    count: counts.get(k),
    ...STATUS_META[k],
  }));
}
