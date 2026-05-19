/**
 * Scorecard scoring math — pure JS, no React, easy to test.
 *
 * Two layers:
 *
 *   componentScore(component, data) → 0-100 | null
 *     - 0-100 means "how close to target this component is"
 *     - null means "couldn't compute" (no target, no data, etc.) and
 *       the aggregate excludes the component from the denominator.
 *
 *   aggregateScore(scoredEntries) → 0-100 | null
 *     - Weighted average of non-null component scores.
 *     - Σweights normalised, so 60/40 and 6/4 give identical results.
 *     - Returns null when every component is null (avoids a misleading
 *       "0%" headline when the data simply isn't there yet).
 *
 * Target-direction handling
 * ─────────────────────────
 * The same widget can have either a ">=" goal (more = better) or a
 * "<=" goal (less = better) depending on the metric. We can't infer
 * direction from the widget alone — REVIEW_ROUNDS is typically "<=",
 * but a user could in theory set ">=" if they're trying to encourage
 * MORE review activity. So the comparator drives the math:
 *
 *   target.op === ">="  → score = min(100, value / target × 100)
 *   target.op === "<="  → score = min(100, target / value × 100)
 *                          (if value === 0, treat as 100 — better
 *                           than the goal)
 *   target.op === "="   → score = max(0, (1 - |value - target| / |target|) × 100)
 *                          (proximity score; same target value either
 *                           way means full marks)
 *
 * Value extraction per widget
 * ───────────────────────────
 * Each widget surfaces a different headline number. We centralise the
 * extraction in `extractValue` so adding a new widget needs one
 * `case` here instead of a switch scattered across every scorecard
 * caller.
 */

import { SOURCE_METRICS } from "@/features/goal-specs";

/**
 * Pull the headline number from a component's data payload. Returns
 * a finite number or null. The widget kind drives the field choice
 * because each widget computes a different scalar.
 */
export function extractValue(component, data) {
  if (!data) return null;
  const widget = component?.widget;
  switch (widget) {
    // Percentage widgets — already 0-100.
    case "FIRST_PASS_RATE":
    case "LINKAGE":
      return safeNum(data.pct);
    case "BUILD_PASS_RATE":
      return safeNum(data.pct);

    // Count widgets.
    case "MERGED_COUNT":
      return safeNum(data.count);
    case "DEPLOY_FREQUENCY":
      return safeNum(data.count);

    // Lower-is-better median widgets. The aggregate inverts when the
    // target op is "<=" so this just hands over the raw median.
    case "TURNAROUND":
      return safeNum(data.median);
    case "TICKET_CYCLE":
      return safeNum(data.median);
    case "LEAD_TIME":
      return safeNum(data.medianMin);
    case "REVIEW_ROUNDS":
      return safeNum(data.value);

    // MANUAL widgets — the data shape comes from the widget's own
    // computation (see each widget file). For the MVP we keep this
    // minimal: COUNTER returns its total, INCIDENT_LOG returns its
    // total downtime, SCALE its latest rating. Anything more nuanced
    // (compliance %, streak, etc.) can be added per-widget as the
    // SCORECARD usage grows.
    case "COUNTER":
      return safeNum(data.total);
    case "INCIDENT_LOG":
      return safeNum(data.totalDowntime ?? data.count);
    case "SCALE":
      return safeNum(data.latest);
    case "MILESTONE":
    case "RECURRING_MILESTONE":
      return safeNum(data.pct);

    // Phase F: CODE_RUBRIC components surface their pass-rate as
    // the score. `data.pct` is computed by the SCORECARD widget
    // from the local verdicts cache via `useGradedPrs.summary`.
    case "CODE_RUBRIC":
      return safeNum(data.pct);

    default:
      return null;
  }
}

/**
 * For score targets we synthesize a default 100% target when the
 * CODE_RUBRIC component doesn't carry one — the user's framing is
 * "we want a high rubric pass rate", and 100% is the natural
 * ceiling. The aggregate function still respects an explicit target
 * if the user sets one.
 */
export function defaultTargetFor(widget) {
  if (widget === "CODE_RUBRIC") return { op: ">=", value: 100 };
  return null;
}

/**
 * Convert a component's value + target into a 0-100 score. Null
 * when no target is set or no value available — the aggregate
 * function drops nulls from its denominator.
 */
export function pctOfTarget(value, target) {
  if (value == null || target == null) return null;
  if (!Number.isFinite(value)) return null;
  const t = Number(target.value);
  if (!Number.isFinite(t)) return null;
  if (target.op === ">=") {
    if (t === 0) return value >= 0 ? 100 : 0;
    return Math.min(100, Math.max(0, Math.round((value / t) * 100)));
  }
  if (target.op === "<=") {
    if (value <= t) return 100;
    if (value === 0) return 100;
    return Math.min(100, Math.max(0, Math.round((t / value) * 100)));
  }
  if (target.op === "=") {
    if (t === 0) return value === 0 ? 100 : 0;
    const diff = Math.abs(value - t);
    return Math.max(0, Math.round((1 - diff / Math.abs(t)) * 100));
  }
  return null;
}

/**
 * Combine `extractValue` + `pctOfTarget` for one component.
 * Convenience wrapper so callers don't have to thread both halves
 * separately.
 */
export function componentScore(component, data) {
  // CODE_RUBRIC's "value" IS its pass-rate (0-100%), so a target is
  // optional — when missing, we default to "≥ 100%" so the score
  // matches what the standalone CodeRubricWidget already displays.
  // Other widgets require an explicit target; null target → null
  // score and the aggregate skips this component.
  const target =
    component?.source?.target ||
    component?.manual?.target ||
    defaultTargetFor(component?.widget);
  if (!target) return null;
  const value = extractValue(component, data);
  return pctOfTarget(value, target);
}

/**
 * Weighted average of component scores. `entries` is an array of
 * `{ weight, score }` pairs — score may be null. Returns 0-100 or
 * null (every score null).
 *
 * Aggregate strategies: only "weighted" implemented in MVP. Other
 * strategies (all-must-pass, worst-of) can branch off this signature
 * later — that's why aggregate is on the spec instead of hardcoded
 * here.
 */
export function aggregateScore(entries, aggregate = "weighted") {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (aggregate !== "weighted") return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const { weight, score } of entries) {
    if (score == null) continue;
    const w = Number.isFinite(weight) && weight >= 0 ? weight : 0;
    weightedSum += w * score;
    weightTotal += w;
  }
  if (weightTotal === 0) return null;
  return Math.round(weightedSum / weightTotal);
}

/**
 * Count of "passing" components — those whose score reached 100
 * (i.e. met their individual target). Used by the SCORECARD widget
 * header to show "2/3 components on target" alongside the aggregate.
 */
export function passingCount(entries) {
  let pass = 0;
  let total = 0;
  for (const { score } of entries || []) {
    if (score == null) continue;
    total += 1;
    if (score >= 100) pass += 1;
  }
  return { pass, total };
}

// Local helper — Number() that returns null on NaN / non-number.
function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Re-export SOURCE_METRICS to keep this file's surface area in one
// place — callers shouldn't need to chase the import.
export { SOURCE_METRICS };
