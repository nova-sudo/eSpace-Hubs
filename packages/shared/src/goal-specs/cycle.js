/**
 * Cycle-length arithmetic shared by the composer (apps/api) and the plan
 * editor (apps/web): "a 13-week plan starting 2026-09-01 ends on which day?"
 *
 * This is the server-side twin of `deriveCycleEndIso` in
 * apps/web/src/features/goal-inputs/cadence-windows.js. That one walks the
 * real window enumeration and reads the Nth window's end, which is the most
 * faithful definition; this one is closed-form calendar math that produces
 * the identical day for every cadence (a regression test in the web package
 * pins the two together across a matrix of starts and counts). It lives here
 * so the API can stamp `composed.cycleEnd` at compose time WITHOUT importing
 * the web's window walker — the bug this closes is precisely a tracker that
 * reached the client with no end and fell back to the calendar year (53
 * weekly windows for a 13-week plan).
 *
 * Contract, matching `enumerateWindows`:
 *   - daily / weekly / biweekly: fixed strides from `cycleStart` itself.
 *   - monthly / quarterly: `cycleStart` is snapped BACK to the first day of
 *     its calendar month / quarter, then N whole calendar periods follow.
 *
 * The returned day is the INCLUSIVE last day (what `composed.cycleEnd`
 * stores); window enumeration adds a day to make its exclusive bound.
 */

const DAY = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STRIDE_DAYS = Object.freeze({ daily: 1, weekly: 7, biweekly: 14 });
const CALENDAR_MONTHS = Object.freeze({ monthly: 1, quarterly: 3 });

/** Hard ceiling on windows in one cycle — mirrors COMPOSED_MAX_PERIODS. */
export const CYCLE_MAX_WINDOWS = 53;

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Inclusive last day (ISO "YYYY-MM-DD") of the `count`-th cadence window
 * starting at `cycleStartIso`, or null for an unparseable start, an unknown
 * cadence, or a count outside 1..CYCLE_MAX_WINDOWS.
 */
export function cycleEndForCount(cycleStartIso, cadence, count) {
  if (typeof cycleStartIso !== "string" || !ISO_DATE_RE.test(cycleStartIso.trim())) {
    return null;
  }
  if (!Number.isInteger(count) || count < 1 || count > CYCLE_MAX_WINDOWS) return null;
  const startMs = Date.parse(cycleStartIso.trim());
  if (Number.isNaN(startMs)) return null;

  if (STRIDE_DAYS[cadence]) {
    return isoDay(startMs + count * STRIDE_DAYS[cadence] * DAY - DAY);
  }
  const months = CALENDAR_MONTHS[cadence];
  if (!months) return null;
  const from = new Date(startMs);
  const y = from.getUTCFullYear();
  const m0 =
    months === 1 ? from.getUTCMonth() : Math.floor(from.getUTCMonth() / 3) * 3;
  // Date.UTC normalises an overflowing month index into the following years.
  return isoDay(Date.UTC(y, m0 + count * months, 1) - DAY);
}

/**
 * How many cadence windows tile [cycleStartIso, cycleEndIso] (both inclusive
 * days), or null when either date is unusable / inverted or the cadence is
 * unknown. The inverse of `cycleEndForCount`, used to read a plan length back
 * off a spec that stored only the date pair.
 */
export function windowCountForCycle(cycleStartIso, cadence, cycleEndIso) {
  if (
    typeof cycleStartIso !== "string" ||
    typeof cycleEndIso !== "string" ||
    !ISO_DATE_RE.test(cycleStartIso.trim()) ||
    !ISO_DATE_RE.test(cycleEndIso.trim())
  ) {
    return null;
  }
  const start = Date.parse(cycleStartIso.trim());
  const endExclusive = Date.parse(cycleEndIso.trim()) + DAY;
  if (Number.isNaN(start) || Number.isNaN(endExclusive) || endExclusive <= start) return null;

  if (STRIDE_DAYS[cadence]) {
    return Math.ceil((endExclusive - start) / (STRIDE_DAYS[cadence] * DAY));
  }
  const months = CALENDAR_MONTHS[cadence];
  if (!months) return null;
  const from = new Date(start);
  const y = from.getUTCFullYear();
  const m0 =
    months === 1 ? from.getUTCMonth() : Math.floor(from.getUTCMonth() / 3) * 3;
  let n = 0;
  while (n < CYCLE_MAX_WINDOWS + 1 && Date.UTC(y, m0 + n * months, 1) < endExclusive) n += 1;
  return n;
}

/**
 * The first day of the cadence period containing `nowMs` — the sensible
 * default start for a plan whose document named no date: a weekly plan
 * accepted on a Wednesday starts that Monday, a monthly one on the 1st, a
 * quarterly one at the quarter's first day. ISO "YYYY-MM-DD".
 */
export function snapCycleStart(cadence, nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (cadence === "monthly") return isoDay(Date.UTC(y, m, 1));
  if (cadence === "quarterly") return isoDay(Date.UTC(y, Math.floor(m / 3) * 3, 1));
  if (cadence === "daily") return isoDay(Date.UTC(y, m, d.getUTCDate()));
  // weekly / biweekly → the Monday of this week (UTC).
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return isoDay(Date.UTC(y, m, d.getUTCDate()) - dow * DAY);
}
