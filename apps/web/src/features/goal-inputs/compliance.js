/**
 * Cadence-aware compliance metric for manual goal inputs.
 *
 * "Did the user hit their per-cadence target consistently across the
 * tracking period?" — answered as a single percentage you can put on a
 * widget headline or a performance review document.
 *
 * Why we track compliance instead of just totaling
 * ────────────────────────────────────────────────
 * The Counter / Scale / Date-log widgets used to surface a lifetime sum
 * as their headline. That misled users on cadence-bound goals: a weekly
 * goal "log 3 mentoring hours per week" with target `>= 3` would read
 * "on target" forever after a single 3-hour log, even if the user logged
 * nothing for the next 50 weeks.
 *
 * Compliance fixes that. We bucket every entry into cadence-sized
 * windows starting at the user's FIRST entry timestamp, then for each
 * window compare the bucketed sum against the target. Each window gets
 * a 0.0–1.0 contribution; the average across windows is the compliance.
 *
 * Partial credit (rather than binary pass/fail) so:
 *   - Logging 2 hours when the bar is 3 doesn't waste the effort
 *   - But over-logging (5 hours when bar is 3) doesn't bank credit
 *     for future shortfalls — caps at 1.0 per window
 *
 * For lower-is-better targets (`<=`) we flip the math: at-or-below = 1.0,
 * over-target = (target / actual). For `=` targets we accept ±10% as a hit.
 *
 * Bucketing window boundaries
 * ───────────────────────────
 * The SAME windows the cadence stepper shows and the snapshot capture
 * keys on: `buildCycleWindows` (calendar months / quarters, fixed
 * strides for weekly / biweekly / daily, anchored on the cycle — the
 * calendar year). Audit #237: this used to bucket from the FIRST ENTRY
 * in fixed 30-day "months" and 91-day "quarters", so a window the
 * stepper called "March" could be compliance's "days 30–59 since your
 * first log" — three surfaces, three answers. Windows counted run from
 * the one containing the first entry through the one containing now.
 *
 * A brand-new goal still starts at "1 of 1 windows" → 100% on the first
 * log; compliance only stops being trivial once a full window has
 * elapsed.
 *
 * ponytail: weekly strides here are Jan-1-anchored (cadence-windows'
 * keys), while snapshot week labels are Sunday-anchored — a residual
 * few-day skew on weekly goals only. Unifying that means migrating every
 * stored weekly periodKey; do it when the skew is actually observed.
 */

import { buildCycleWindows } from "./cadence-windows";

/**
 * Compute compliance for a manual-widget entry log against a target.
 *
 * @param {Array<{ ts: number, value: any }>} entries
 *        Time-series entries (already sorted ts-ascending by the store).
 * @param {{ op: ">=" | "<=" | "=", value: number } | null | undefined} target
 *        Target constraint from `spec.manual.target`.
 * @param {string} cadence
 *        One of "daily" / "weekly" / "biweekly" / "monthly" / "quarterly".
 *        Returns null for unsupported cadences.
 *
 * @returns {{
 *   pct: number,           // 0..100, rounded
 *   metWindows: number,    // count of windows that fully met the target
 *   totalWindows: number,  // count of windows since first entry
 *   targetOp: string,
 *   targetValue: number,
 *   cadence: string,
 *   partial: boolean,      // true when totalWindows < 1 full cadence
 * } | null}
 *   `null` when there's no usable data (no target, no entries, unsupported cadence).
 */
export function computeCompliance(entries, target, cadence, now = Date.now()) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (!target || target.value == null || !Number.isFinite(target.value)) {
    return null;
  }
  const cycle = buildCycleWindows({ entries, cadence, now });
  if (cycle.mode === "pip" || !Array.isArray(cycle.windows)) return null;

  const firstTs = Math.min(...entries.map((e) => e.ts));
  // Windows from the one containing the first entry through the one
  // containing now. Entries outside the cycle (last year's) bucket into
  // the edge windows rather than vanishing — the cycle IS the review
  // period, but a log is never silently dropped.
  const inRange = cycle.windows.filter((w) => w.end > firstTs && w.start <= now);
  const windows = inRange.length > 0 ? inRange : cycle.windows.slice(-1);
  const windowCount = windows.length;

  const buckets = new Array(windowCount).fill(0);
  for (const e of entries) {
    const v = Number(e.value);
    if (!Number.isFinite(v)) continue;
    let idx = windows.findIndex((w) => e.ts >= w.start && e.ts < w.end);
    if (idx < 0) idx = e.ts < windows[0].start ? 0 : windowCount - 1;
    buckets[idx] += v;
  }

  const op = target.op || ">=";
  const t = target.value;

  let contribution = 0;
  let metWindows = 0;
  // Whether the MOST RECENT window (the current, still-open cadence
  // period) hit its target — the "are you on pace right now?" signal the
  // live compliance summary reads, distinct from the lifetime average.
  let latestWindowMet = false;
  for (let i = 0; i < buckets.length; i += 1) {
    const sum = buckets[i];
    let weight;
    let hit = false;
    if (op === ">=") {
      // Cap at 1.0 — over-logging this window doesn't carry to the next.
      weight = t > 0 ? Math.min(sum, t) / t : 0;
      hit = sum >= t;
    } else if (op === "<=") {
      // At-or-below = full credit. Over-target = penalty proportional to
      // overshoot, but bounded so going wildly over doesn't go negative.
      if (sum <= t) {
        weight = 1;
        hit = true;
      } else {
        weight = t / sum; // (0, 1) since sum > t > 0 in this branch
      }
    } else if (op === "=") {
      // Within ±10% counts as hitting. Closer = better but binary
      // beyond that (don't try to be clever).
      const within = Math.abs(sum - t) / Math.max(1, Math.abs(t));
      hit = within <= 0.1;
      weight = hit ? 1 : 0;
    } else {
      weight = 0;
    }
    if (hit) metWindows += 1;
    contribution += weight;
    if (i === buckets.length - 1) latestWindowMet = hit;
  }

  const ratio = contribution / windowCount;
  const pct = Math.round(ratio * 100);

  return {
    pct,
    metWindows,
    totalWindows: windowCount,
    latestWindowMet,
    targetOp: op,
    targetValue: t,
    cadence,
    partial: windowCount < 2,
  };
}

/**
 * Cadence-window label for the UI sub-line — pluralised correctly so
 * the compliance row reads naturally.
 */
export function cadenceWindowLabel(cadence) {
  switch (cadence) {
    case "daily":
      return ["day", "days"];
    case "weekly":
      return ["week", "weeks"];
    case "biweekly":
      return ["fortnight", "fortnights"];
    case "monthly":
      return ["month", "months"];
    case "quarterly":
      return ["quarter", "quarters"];
    default:
      return ["window", "windows"];
  }
}
