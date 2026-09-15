/**
 * The Intelligence page's bridge onto the canonical roll-up.
 *
 * The maths and the status vocabulary live in
 * `goal-inputs/goal-progress` — this file only translates a
 * `useGoalHealth()` card into the shared shape. It used to own a second copy
 * of the arithmetic, which is how this page came to print 89% while the
 * Goals page printed 33% for the same cycle: one excluded unmeasurable
 * objectives, the other scored them zero.
 */

import { HEALTH } from "./status";
import {
  GOAL_STATUS,
  STATUS_META,
  goalProgress,
  objectiveProgress,
  weightedProgress,
  worstStatus,
  countStatuses,
} from "@/features/goal-inputs";

/**
 * One goal's cadence completion, 0–100, or null when it has no windows to
 * complete.
 *
 * @param {{ health: object }} card  a useGoalHealth() card
 */

/** A `useGoalHealth()` card's health, in the shared status vocabulary. */
export function statusOf(card) {
  const h = card?.health;
  if (!h) return GOAL_STATUS.UNCLASSIFIED;
  const tier = card?.tier;
  if (tier === "over_achieved" || tier === "role_model") return GOAL_STATUS.EXCEEDING;
  switch (h.status) {
    case HEALTH.UNCLASSIFIED:
      return GOAL_STATUS.UNCLASSIFIED;
    case HEALTH.NEEDS_SETUP:
      return GOAL_STATUS.NEEDS_SETUP;
    case HEALTH.AUTO:
      return GOAL_STATUS.AUTO;
    case HEALTH.NO_DATA:
      return GOAL_STATUS.NOT_LOGGED;
    case HEALTH.STALE:
    case HEALTH.BEHIND:
      return GOAL_STATUS.BEHIND;
    default:
      return GOAL_STATUS.ON_PACE;
  }
}

export function goalProgressPercent(card) {
  return goalProgress({
    status: statusOf(card),
    cycle: card?.health?.fill,
    hasData: Boolean(card?.health?.fill?.hasData),
  });
}

/**
 * An objective's rolled-up percentage: the mean of its measurable children.
 * Returns null when nothing under it is measurable.
 */
export function objectiveProgressPercent(cards) {
  return objectiveProgress((cards || []).map((c) => goalProgressPercent(c)));
}

/**
 * Progress across the whole tree, weighted by each objective's KRA
 * weightage. Objectives with no weightage set fall back to equal weights, so
 * a user who never filled the weightage column still gets an honest average
 * instead of a zero.
 */
export function weightedProgressPercent(groups) {
  return weightedProgress(
    (groups || []).map((g) => ({
      pct: objectiveProgressPercent(g.cards),
      weight: g.l1?.weightage,
    })),
  );
}


/**
 * The weakest child's status chip for an objective's band header.
 * @returns {{ label: string, tone: string } | null}
 */
export function worstChildStatus(cards) {
  const key = worstStatus((cards || []).map((c) => statusOf(c)));
  return key ? { label: STATUS_META[key].label, tone: STATUS_META[key].tone } : null;
}

/**
 * The four counts the summary strip carries. Auto-tracked goals sit under
 * "on pace" (they are meeting their target or they aren't — there is nothing
 * for the user to do either way), and goals still awaiting setup sit under
 * "not logged", which is what they are from the user's side. `unclassified`
 * isn't derivable from the health groups (an unclassified goal never reaches
 * them), so it is passed in from useGoalWidgetItems().
 */
export function statusCounts(groups, unclassified = 0) {
  const statuses = (groups || []).flatMap((g) => (g.cards || []).map((c) => statusOf(c)));
  for (let i = 0; i < (unclassified || 0); i += 1) statuses.push(GOAL_STATUS.UNCLASSIFIED);
  return countStatuses(statuses);
}

/**
 * `<FillStrip>` cells for a goal's cadence windows.
 *
 * `fill.windows` is the WHOLE cycle, oldest→newest, with everything after the
 * current window still unstarted — so slicing the array's tail would show a
 * weekly goal's empty December instead of its recent activity. Both call
 * sites centre on `currentIndex` instead.
 *
 * @param {object|null} fill    health.fill
 * @param {{ cap?: number, endAtCurrent?: boolean }} opts
 *        `endAtCurrent` cuts the strip AT the current window (the focus hero's
 *        "last N weeks" read-out); otherwise a short cycle keeps its future
 *        windows visible, so "3 of 4 quarters" shows the quarter still to come.
 */
export function cadenceCells(fill, { cap = 10, endAtCurrent = false } = {}) {
  if (!fill || !fill.total || !Array.isArray(fill.windows)) return [];
  const windows = fill.windows;
  const idx = Number.isInteger(fill.currentIndex) ? fill.currentIndex : windows.length - 1;
  const slice =
    endAtCurrent || windows.length > cap
      ? windows.slice(Math.max(0, idx - cap + 1), idx + 1)
      : windows;
  return slice.map((w) => ({ key: w?.key, label: w?.label, state: w?.state || "future" }));
}

function clampPct(n) {
  return Math.round(Math.max(0, Math.min(100, Number(n) || 0)));
}
