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

/** One goal's status, shared by every surface. Worst first. */
export const GOAL_STATUS = Object.freeze({
  BEHIND: "behind",
  NOT_LOGGED: "not-logged",
  NEEDS_SETUP: "needs-setup",
  UNCLASSIFIED: "unclassified",
  ON_PACE: "on-pace",
  AUTO: "auto",
  EXCEEDING: "exceeding",
});

/** Tone + wording per status. Tone is the design system's tint name. */
export const STATUS_META = Object.freeze({
  [GOAL_STATUS.BEHIND]: { tone: "peach", label: "Behind" },
  [GOAL_STATUS.NOT_LOGGED]: { tone: "lemon", label: "Not logged" },
  [GOAL_STATUS.NEEDS_SETUP]: { tone: "lemon", label: "Needs setup" },
  [GOAL_STATUS.UNCLASSIFIED]: { tone: "neutral", label: "Unclassified" },
  [GOAL_STATUS.ON_PACE]: { tone: "mint", label: "On pace" },
  [GOAL_STATUS.AUTO]: { tone: "mint", label: "Auto-tracked" },
  [GOAL_STATUS.EXCEEDING]: { tone: "sky", label: "Exceeding" },
});

/**
 * Severity order, worst first. Drives an objective's chip (Perdoo's rule: a
 * parent's NUMBER is an average, its STATUS is its weakest child) and the
 * order the summary badges appear in.
 */
export const SEVERITY = Object.freeze([
  GOAL_STATUS.BEHIND,
  GOAL_STATUS.NOT_LOGGED,
  GOAL_STATUS.NEEDS_SETUP,
  GOAL_STATUS.UNCLASSIFIED,
  GOAL_STATUS.ON_PACE,
  GOAL_STATUS.AUTO,
  GOAL_STATUS.EXCEEDING,
]);

/** Statuses that carry no completion figure — excluded from every average. */
const UNMEASURABLE = new Set([
  GOAL_STATUS.AUTO,
  GOAL_STATUS.NEEDS_SETUP,
  GOAL_STATUS.UNCLASSIFIED,
]);

export function isMeasurable(status) {
  return !UNMEASURABLE.has(status);
}

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
 */
export function goalProgress({ status, cycle, hasData = false } = {}) {
  if (status && !isMeasurable(status)) return null;
  if (cycle && cycle.total > 0) {
    return clampPct((cycle.filledCount / cycle.total) * 100);
  }
  // Non-bucketing kinds — milestone, before/after, per-incident. There is no
  // partial credit: the thing happened or it did not.
  if (hasData) return 100;
  if (status === GOAL_STATUS.NOT_LOGGED) return 0;
  return null;
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

/** The weakest child's status, for an objective's chip. */
export function worstStatus(statuses) {
  let worst = null;
  let rank = Infinity;
  for (const s of statuses || []) {
    const i = SEVERITY.indexOf(s);
    const r = i < 0 ? SEVERITY.length : i;
    if (r < rank) {
      rank = r;
      worst = s;
    }
  }
  return worst;
}

/**
 * Ordered counts for the summary badges, worst first. Every surface counts
 * the same buckets over the same per-goal statuses, so two pages showing the
 * same goals can no longer print different tallies.
 *
 * @returns {Array<{status:string, count:number, tone:string, label:string}>}
 */
export function countStatuses(statuses) {
  const counts = new Map();
  for (const s of statuses || []) counts.set(s, (counts.get(s) || 0) + 1);
  return SEVERITY.filter((k) => counts.get(k) > 0).map((k) => ({
    status: k,
    count: counts.get(k),
    ...STATUS_META[k],
  }));
}
