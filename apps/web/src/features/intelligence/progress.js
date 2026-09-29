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

import {
  GOAL_STATUS,
  STATUS_META,
  loggedPercent,
  loggedTotals,
  objectiveProgress,
  objectiveStatus,
  weightedProgress,
  countStatuses,
  windowCellTitle,
} from "@/features/goal-inputs";

/** A `useGoalHealth()` card's status key, from the ONE shared model. */
export function statusOf(card) {
  return card?.status?.status ?? GOAL_STATUS.UNCLASSIFIED;
}

/**
 * One goal's "logged so far", 0–100 — of the check-ins that were due, how
 * many were logged — or null when nothing about it is due yet / it isn't
 * measured. The same number the Goals page shows.
 */
export function goalProgressPercent(card) {
  return loggedPercent({
    goal: card?.status,
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
 * "Logged so far" across the whole tree, weighted by each objective's KRA
 * weightage. Objectives with nothing measured drop out (their weight goes
 * with them); no weightages at all → a flat mean.
 */
export function weightedProgressPercent(groups) {
  return weightedProgress(
    (groups || []).map((g) => ({
      pct: objectiveProgressPercent(g.cards),
      weight: g.l1?.weightage,
    })),
  );
}

/** `{ done, due }` check-ins across every measured goal — the sub-line. */
export function loggedCheckIns(groups) {
  return loggedTotals((groups || []).flatMap((g) => (g.cards || []).map((c) => c.status)));
}

/** Goals that aren't in the headline number (no tracker, setup, auto, nothing due). */
export function unmeasuredCount(groups, unclassified = 0) {
  let n = unclassified || 0;
  for (const g of groups || []) for (const c of g.cards || []) if (goalProgressPercent(c) == null) n += 1;
  return n;
}

/**
 * An objective's chip: its weakest MEASURED child (the same rule on every
 * surface — goal-inputs `objectiveStatus`).
 * @returns {{ label: string, tone: string } | null}
 */
export function worstChildStatus(cards) {
  const key = objectiveStatus((cards || []).map((c) => statusOf(c)));
  return key ? { label: STATUS_META[key].label, tone: STATUS_META[key].tone } : null;
}

/**
 * The status badges, worst first — the shared buckets over the shared
 * per-goal statuses, so Home and Goals can't tally the same goals
 * differently. Goals with no tracker never reach the health groups, so their
 * count is passed in from useGoalWidgetItems().
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
  return slice.map((w) => {
    const state = w?.state || "future";
    return { key: w?.key, label: w?.label, state, title: windowCellTitle(w, state) };
  });
}
