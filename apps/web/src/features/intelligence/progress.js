/**
 * Roll-up math for the Intelligence page's summary strip and objective
 * bands. Pure — no React, no IO. Everything here reads the cards
 * `useGoalHealth()` already derived.
 *
 * The one number this file computes is CADENCE COMPLETION: of the windows a
 * goal's cycle asks for, how many are logged. It is the only progress figure
 * the app can state without inventing one, and it is directly comparable to
 * the pacing tick `<PacedBar>` draws (how far through the year we are), which
 * is what makes a bare percentage mean anything.
 *
 * Goals with no window model — AUTO trackers, goals still awaiting setup,
 * unclassified ones — return null and are EXCLUDED from the averages rather
 * than counted as zero. A band of two auto goals says "—", not "0%".
 */

import { HEALTH, statusDisplay } from "./status";

/**
 * One goal's cadence completion, 0–100, or null when it has no windows to
 * complete.
 *
 * @param {{ health: object }} card  a useGoalHealth() card
 */
export function goalProgressPercent(card) {
  const health = card?.health;
  if (!health) return null;
  if (
    health.status === HEALTH.AUTO ||
    health.status === HEALTH.NEEDS_SETUP ||
    health.status === HEALTH.UNCLASSIFIED
  ) {
    return null;
  }
  const fill = health.fill;
  if (fill && fill.total > 0) {
    return clampPct((fill.filledCount / fill.total) * 100);
  }
  if (health.status === HEALTH.NO_DATA) return 0;
  // Non-bucketing kinds (milestone / before-after / per-incident): they have
  // data or they don't — there is no partial.
  if (fill?.hasData) return 100;
  return null;
}

/**
 * An objective's rolled-up percentage: the mean of its measurable children.
 * Returns null when nothing under it is measurable.
 */
export function objectiveProgressPercent(cards) {
  const values = (cards || [])
    .map((c) => goalProgressPercent(c))
    .filter((v) => v != null);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Progress across the whole tree, weighted by each objective's KRA
 * weightage. Objectives with no weightage set fall back to equal weights, so
 * a user who never filled the weightage column still gets an honest average
 * instead of a zero.
 */
export function weightedProgressPercent(groups) {
  let weighted = 0;
  let weight = 0;
  const measurable = [];
  for (const group of groups || []) {
    const pct = objectiveProgressPercent(group.cards);
    if (pct == null) continue;
    measurable.push(pct);
    const w = Number(group.l1?.weightage) || 0;
    if (w > 0) {
      weighted += pct * w;
      weight += w;
    }
  }
  if (measurable.length === 0) return null;
  if (weight > 0) return Math.round(weighted / weight);
  return Math.round(measurable.reduce((a, b) => a + b, 0) / measurable.length);
}

// Worst-first. Perdoo's rule: a parent's STATUS is its weakest child even
// though its NUMBER is an average — a band that averages to 80% while one
// goal is behind must still read "Behind".
const TONE_SEVERITY = ["peach", "lemon", "neutral", "sky", "lav", "mint"];

/**
 * The weakest child's status chip for an objective's band header.
 * @returns {{ label: string, tone: string } | null}
 */
export function worstChildStatus(cards) {
  let worst = null;
  let worstRank = Infinity;
  for (const card of cards || []) {
    const meta = statusDisplay(card.health);
    if (!meta) continue;
    const rank = TONE_SEVERITY.indexOf(meta.tone);
    const r = rank < 0 ? TONE_SEVERITY.length : rank;
    if (r < worstRank) {
      worstRank = r;
      worst = { label: meta.label, tone: meta.tone };
    }
  }
  return worst;
}

/**
 * The four counts the summary strip carries. Auto-tracked goals sit under
 * "on pace" (they are meeting their target or they aren't — there is nothing
 * for the user to do either way), and goals still awaiting setup sit under
 * "not logged", which is what they are from the user's side. `unclassified`
 * isn't derivable from the health groups (an unclassified goal never reaches
 * them), so it is passed in from useGoalWidgetItems().
 */
export function statusCounts(summary, unclassified = 0) {
  const s = summary || {};
  return {
    onPace: (s.onPace || 0) + (s.auto || 0),
    behind: s.behind || 0,
    notLogged: (s.noData || 0) + (s.stale || 0) + (s.setup || 0),
    unclassified: unclassified || 0,
  };
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
