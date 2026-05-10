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
 * From the first entry's timestamp, forward. So if your first entry was
 * 10 weeks ago and we're on a weekly cadence, you have 10 windows. As
 * time moves forward, the next window opens automatically and starts
 * counting against you if you haven't logged.
 *
 * We don't pre-compute "expected windows since the goal was created"
 * (we don't track that), so a brand-new goal starts at "1 of 1 windows"
 * → 100% the moment you log once. The compliance only stops being
 * trivial after at least one full cadence has elapsed.
 */

const CADENCE_DAYS = Object.freeze({
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30, // approximate — calendar-month variance washes out at scale
  quarterly: 91,
  // The remaining cadences either don't bucket (continuous, milestone)
  // or are situational (per-incident). We fall back to lifetime totals
  // for those — see callers.
});

const DAY_MS = 24 * 60 * 60 * 1000;

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
export function computeCompliance(entries, target, cadence) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (!target || target.value == null || !Number.isFinite(target.value)) {
    return null;
  }
  const cadDays = CADENCE_DAYS[cadence];
  if (!cadDays) return null;

  const cadMs = cadDays * DAY_MS;
  const firstTs = entries[0].ts;
  const now = Date.now();
  const elapsed = Math.max(0, now - firstTs);

  // Number of windows since the first entry. At least 1 — even if the
  // first log was today, we count "this window" so the user sees their
  // log immediately reflected.
  const windowCount = Math.max(1, Math.ceil(elapsed / cadMs));

  // Bucket entries into windows from first entry forward.
  const buckets = new Array(windowCount).fill(0);
  for (const e of entries) {
    const offset = e.ts - firstTs;
    const idx = Math.min(windowCount - 1, Math.max(0, Math.floor(offset / cadMs)));
    const v = Number(e.value);
    if (Number.isFinite(v)) buckets[idx] += v;
  }

  const op = target.op || ">=";
  const t = target.value;

  let contribution = 0;
  let metWindows = 0;
  for (const sum of buckets) {
    let weight;
    if (op === ">=") {
      // Cap at 1.0 — over-logging this window doesn't carry to the next.
      weight = t > 0 ? Math.min(sum, t) / t : 0;
      if (sum >= t) metWindows += 1;
    } else if (op === "<=") {
      // At-or-below = full credit. Over-target = penalty proportional to
      // overshoot, but bounded so going wildly over doesn't go negative.
      if (sum <= t) {
        weight = 1;
        metWindows += 1;
      } else {
        weight = t / sum; // (0, 1) since sum > t > 0 in this branch
      }
    } else if (op === "=") {
      // Within ±10% counts as hitting. Closer = better but binary
      // beyond that (don't try to be clever).
      const within = Math.abs(sum - t) / Math.max(1, Math.abs(t));
      const hit = within <= 0.1;
      weight = hit ? 1 : 0;
      if (hit) metWindows += 1;
    } else {
      weight = 0;
    }
    contribution += weight;
  }

  const ratio = contribution / windowCount;
  const pct = Math.round(ratio * 100);

  return {
    pct,
    metWindows,
    totalWindows: windowCount,
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
