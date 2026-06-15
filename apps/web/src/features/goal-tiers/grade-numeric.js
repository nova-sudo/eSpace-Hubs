/**
 * Deterministic tier grading — the W1 "close the loop" core.
 *
 * When a spec carries a numeric `tierScale`, the tier is decided by
 * comparing the widget's own reading to the thresholds — no AI call. This
 * makes grading instant, free, and ALWAYS consistent with the number the
 * widget displays (the bug being fixed: the AI grader saying "the provided
 * data doesn't help me rank it"). Qualitative widgets (no tierScale, or no
 * numeric reading) still fall back to the AI grader.
 *
 * Pure — no React, no IO.
 */

import { SPEC_KINDS, SPEC_KIND_META, SPEC_VARIANTS } from "@/features/goal-specs";

const TIER_LABELS = {
  not_achieved: "not achieved",
  achieved: "achieved",
  over_achieved: "over achieved",
  role_model: "role model",
};

function fmt(n) {
  if (!Number.isFinite(n)) return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Grade a numeric `value` against a validated `tierScale`. Returns a verdict
 * { tier, reasoning, confidence } or null when it can't grade.
 */
export function gradeNumericTier(value, tierScale) {
  if (typeof value !== "number" || !Number.isFinite(value) || !tierScale) {
    return null;
  }
  const { direction, achieved, overAchieved, roleModel, unit } = tierScale;
  const meets = (threshold) => {
    if (threshold == null || !Number.isFinite(threshold)) return false;
    return direction === "lower" ? value <= threshold : value >= threshold;
  };

  let tier;
  if (meets(roleModel)) tier = "role_model";
  else if (meets(overAchieved)) tier = "over_achieved";
  else if (meets(achieved)) tier = "achieved";
  else tier = "not_achieved";

  const u = unit ? ` ${unit}` : "";
  const cmp = direction === "lower" ? "≤" : "≥";
  const achievedTxt =
    achieved != null ? ` (achieved at ${cmp} ${fmt(achieved)}${u})` : "";
  return {
    tier,
    reasoning: `${fmt(value)}${u} → ${TIER_LABELS[tier]}${achievedTxt}.`,
    confidence: "high",
  };
}

/**
 * Extract the single numeric reading a widget should be graded on.
 * Returns { value, unit } or null when there's no usable number yet
 * (→ caller shows "awaiting data" or falls back to the AI grader).
 *
 *   COUNTER   → sum of entries
 *   SCALE     → latest rating (1–5)
 *   DATE_LOG  → number of entries
 *   AUTO      → the captured snapshot reading's primary numeric field
 *   others    → null (qualitative: milestone, free-text, before-after,
 *               incident, rubric, scorecard → AI grader / completion)
 */
export function numericReadingFor(spec, entries, snapshotReading) {
  const widget = spec?.widget;
  const list = Array.isArray(entries) ? entries : [];
  const manualUnit = spec?.manual?.unit || null;

  switch (widget) {
    case SPEC_KINDS.COUNTER: {
      if (list.length === 0) return null;
      const sum = list.reduce((s, e) => s + (Number(e?.value) || 0), 0);
      return { value: sum, unit: manualUnit };
    }
    case SPEC_KINDS.SCALE: {
      const latest = list[list.length - 1];
      const v = Number(latest?.value);
      return Number.isFinite(v) ? { value: v, unit: "of 5" } : null;
    }
    case SPEC_KINDS.DATE_LOG:
      return list.length > 0 ? { value: list.length, unit: "entries" } : null;
    default: {
      // AUTO-family widgets read from the captured snapshot. Qualitative
      // manual widgets (milestone/free-text/etc.) aren't numerically gradeable
      // here — return null so the AI grader (or completion logic) handles them.
      if (SPEC_KIND_META[widget]?.variant !== SPEC_VARIANTS.AUTO) return null;
      const r = snapshotReading;
      if (!r || typeof r !== "object") return null;
      const raw =
        r.weekContribution ?? r.cumulative ?? r.value ?? null;
      const n = raw == null ? null : Number(raw);
      return Number.isFinite(n)
        ? { value: n, unit: spec?.source?.metric || null }
        : null;
    }
  }
}
