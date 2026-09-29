/**
 * The ONE roll-up. Every surface that prints a goal percentage or a status
 * count reads it from here.
 *
 * This exists because the Goals page and the Intelligence page each grew
 * their own copy and then disagreed on screen — 33% against 89% for the same
 * cycle, and "1 not logged · 3 on pace · 1 exceeding" against "5 on pace" for
 * the same five goals. Both were self-consistent; the app was simply stating
 * two different facts under one label.
 *
 * Pure: no React, no IO. Callers hand in what they already derived.
 *
 * ── The number ──────────────────────────────────────────────────────────
 * Progress is CADENCE COMPLETION: of the windows a goal's cycle asks for,
 * how many are logged. It is the only figure the app can state without
 * inventing one, and it is directly comparable to the pacing tick, which is
 * how far through the cycle we are — so "48% when you should be at 71%"
 * means something, where a bare 48% does not.
 *
 * ── The decision that caused the split ──────────────────────────────────
 * A goal with no window model — auto-tracked, awaiting setup, unclassified —
 * has no completion figure. It is UNMEASURABLE, which is not the same as
 * zero. It returns null and is EXCLUDED from every average, rather than
 * being scored nought. Counting an auto-tracked objective as total failure
 * is simply false, and with a 40%-weighted objective it drags the headline
 * number down by half. An objective with nothing measurable under it reads
 * "—", never "0%".
 */

// The status vocabulary (one label, one tint, one sentence per state), the
// severity order and the per-goal rule live in the shared package so the
// API's manager board derives the SAME status — see
// packages/shared/src/goal-specs/goal-status.js.
import {
  GOAL_STATUS,
  STATUS_META,
  SEVERITY,
  isMeasurable,
  goalStatus,
  loggedSoFar,
  objectiveStatus,
  periodWords,
  quietWindows,
  statusMeta,
  worstStatus,
  countStatuses,
} from "@espace-devhub/shared/goal-specs";

export {
  GOAL_STATUS,
  STATUS_META,
  SEVERITY,
  isMeasurable,
  goalStatus,
  loggedSoFar,
  objectiveStatus,
  periodWords,
  quietWindows,
  statusMeta,
  worstStatus,
  countStatuses,
};

function clampPct(n) {
  return Math.round(Math.max(0, Math.min(100, Number(n) || 0)));
}

/**
 * One goal's progress, 0–100, or null when it has nothing to complete.
 *
 * @param {object}  opts
 * @param {string}  opts.status   a GOAL_STATUS
 * @param {object}  opts.cycle    a buildCycleWindows() result, or null
 * @param {boolean} opts.hasData  any entry at all (for non-bucketing kinds)
 * @param {number}  [opts.fraction] 0–1 completion for a non-bucketing kind
 *                                  that CAN state one (a milestone's
 *                                  done ÷ total). Wins over `hasData`.
 */
export function goalProgress({ status, cycle, hasData = false, fraction } = {}) {
  if (status && !isMeasurable(status)) return null;
  if (cycle && cycle.total > 0) {
    // A window settled as "nothing to report" is done, not missing — the
    // number here is "did you keep up", and a settled window kept up.
    const done = Number.isFinite(cycle.doneCount) ? cycle.doneCount : cycle.filledCount;
    return clampPct((done / cycle.total) * 100);
  }
  // A checklist knows how far along it is — say that, not 100% after the
  // first tick.
  if (typeof fraction === "number" && Number.isFinite(fraction)) {
    return clampPct(fraction * 100);
  }
  // Non-bucketing kinds — before/after, per-incident. There is no partial
  // credit: the thing happened or it did not.
  if (hasData) return 100;
  if (status === GOAL_STATUS.NOT_LOGGED) return 0;
  return null;
}

/**
 * Where one goal SHOULD be by now, 0–100 — the pacing tick its progress is
 * compared against — or null when it has no progress figure at all.
 *
 * A windowed goal paces over the windows that COUNT: a tracker created in
 * late September doesn't "expect" 74% (the share of the year gone) — its
 * pre-creation windows are optional backfill (`buildCycleWindows`'
 * "before" state), so its tick starts at its own first counted window.
 * Anything else falls back to `fallback` (the year elapsed), as before.
 */
export function goalExpected({ status, cycle, fallback = null } = {}) {
  if (status && !isMeasurable(status)) return null;
  if (cycle && cycle.total > 0 && Number.isFinite(cycle.expectedPct)) {
    return clampPct(cycle.expectedPct);
  }
  return fallback;
}

/**
 * An objective's number: the mean of its MEASURABLE children. Null when
 * nothing under it can be measured — the caller renders "—".
 */
export function objectiveProgress(percents) {
  const values = (percents || []).filter((v) => v != null && Number.isFinite(v));
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * The headline. Each objective's number times its share of the cycle.
 *
 * Objectives with no measurable children are skipped entirely — they take no
 * weight with them, so the remaining weights are renormalised rather than the
 * objective counting as zero. Falls back to a flat mean when the imported
 * tree carries no weightages at all.
 *
 * @param {Array<{pct:number|null, weight:number|null|undefined}>} objectives
 */
export function weightedProgress(objectives) {
  const measurable = (objectives || []).filter(
    (o) => o && o.pct != null && Number.isFinite(o.pct),
  );
  if (measurable.length === 0) return null;
  let weighted = 0;
  let totalWeight = 0;
  for (const o of measurable) {
    const w = Number(o.weight) || 0;
    if (w > 0) {
      weighted += o.pct * w;
      totalWeight += w;
    }
  }
  if (totalWeight > 0) return Math.round(weighted / totalWeight);
  return Math.round(measurable.reduce((a, b) => a + b.pct, 0) / measurable.length);
}

/**
 * "Logged so far" for one goal, 0–100, or null when nothing about it is due
 * yet. This is the ONE headline number (Home's summary, the Goals overview,
 * each objective's figure): of the check-ins that were DUE — ended windows
 * since the tracker started, plus this window once it's logged — how many
 * were logged or settled. Future windows and pre-tracker windows are never in
 * the denominator, so "5 of 6 weeks" can't read "5 of 19".
 *
 * A goal without cadence windows (milestone, per-incident) has nothing
 * "due": a checklist states its own done ÷ total; anything else counts once
 * it has data, and stays out of the number until then.
 *
 * @param {object} opts
 * @param {object} opts.goal       a goalStatus() result
 * @param {number} [opts.fraction] 0–1 for a checklist
 * @param {boolean} [opts.hasData]
 */
export function loggedPercent({ goal, fraction, hasData = false } = {}) {
  if (!goal || !isMeasurable(goal.status)) return null;
  const logged = goal.logged;
  if (logged) return logged.due > 0 ? clampPct((logged.done / logged.due) * 100) : null;
  if (typeof fraction === "number" && Number.isFinite(fraction)) return clampPct(fraction * 100);
  if (hasData) return 100;
  return null;
}

/** Totals across goals for the "N of M check-ins" sub-line. */
export function loggedTotals(goals) {
  let done = 0;
  let due = 0;
  for (const g of goals || []) {
    if (!g?.logged || !isMeasurable(g.status)) continue;
    done += g.logged.done;
    due += g.logged.due;
  }
  return { done, due };
}

/** "10 goals aren't measured yet — they're not in this number." (or null) */
export function unmeasuredLine(count) {
  if (!count) return null;
  return count === 1
    ? "1 goal isn't measured yet — it's not in this number."
    : `${count} goals aren't measured yet — they're not in this number.`;
}
