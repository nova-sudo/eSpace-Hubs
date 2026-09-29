/**
 * Period keys for RECURRING_MILESTONE checklists — the ONE definition shared
 * by the Goals-page widget and the check-in editor, so a tick from either
 * surface lands on the same key for the same period.
 *
 *   daily      → "YYYY-MM-DD"
 *   weekly     → "YYYY-Wnn"   Sunday work week (weeks.js), keyed by its Sunday
 *   biweekly   → "YYYY-Bnn"   pairs of those weeks: floor((week − 1) / 2)
 *   monthly    → "YYYY-MM"
 *   quarterly  → "YYYY-Q#"
 *   other      → "all"        (non-resetting list)
 *
 * Weekly keys keep the historic "YYYY-Wnn" shape, and the week NUMBER now
 * comes from the same Sunday rule as the cadence windows and snapshots. Older
 * entries were written with ISO (Monday) numbers from the widget and
 * 1-January-anchored numbers from the check-in editor; both name a week that
 * overlaps the Sunday week of the same number by at least 4 days, so existing
 * checklists stay on their week without a rewrite.
 *
 * A week is keyed by its SUNDAY, so the week that straddles New Year stays
 * one period ("2026-W53" covers Sun 27 Dec → Sat 2 Jan) rather than splitting
 * into two keys mid-week.
 *
 * Pure — no React, no IO. UTC, like every window boundary.
 */
import { DAY_MS, WEEK_MS, sundayOnOrBeforeUtc, sunWeekNumberUtc } from "./weeks.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** UTC midnight of the Sunday that starts week `n` of `year` (week 1 contains 1 Jan). */
function sundayOfWeek(year, n) {
  const jan1 = Date.UTC(year, 0, 1);
  const week1Sunday = jan1 - new Date(jan1).getUTCDay() * DAY_MS;
  return week1Sunday + (n - 1) * WEEK_MS;
}

function weekParts(ts) {
  const sunday = sundayOnOrBeforeUtc(ts);
  return [new Date(sunday).getUTCFullYear(), sunWeekNumberUtc(sunday)];
}

/** Stable key for the period containing `ts`. */
export function recurringPeriodKey(ts, cadence) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "all";
  switch (cadence) {
    case "daily":
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    case "weekly": {
      const [y, w] = weekParts(ts);
      return `${y}-W${pad2(w)}`;
    }
    case "biweekly": {
      const [y, w] = weekParts(ts);
      return `${y}-B${pad2(Math.floor((w - 1) / 2))}`;
    }
    case "monthly":
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
    case "quarterly":
      return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    default:
      return "all";
  }
}

/**
 * The key one period before `key`, or null when it can't be stepped
 * (e.g. "all", or a malformed key). Used by the streak counter.
 */
export function previousRecurringPeriodKey(key, cadence) {
  if (typeof key !== "string" || key === "all") return null;
  if (cadence === "weekly") {
    const m = /^(\d{4})-W(\d{2})$/.exec(key);
    if (!m) return null;
    return recurringPeriodKey(sundayOfWeek(+m[1], +m[2]) - WEEK_MS, "weekly");
  }
  if (cadence === "biweekly") {
    const m = /^(\d{4})-B(\d{2})$/.exec(key);
    if (!m) return null;
    // First week of this bucket, then one week back lands in the previous bucket.
    const firstWeek = +m[2] * 2 + 1;
    return recurringPeriodKey(sundayOfWeek(+m[1], firstWeek) - WEEK_MS, "biweekly");
  }
  if (cadence === "daily") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) return null;
    return recurringPeriodKey(Date.UTC(+m[1], +m[2] - 1, +m[3]) - DAY_MS, "daily");
  }
  if (cadence === "monthly") {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) return null;
    return recurringPeriodKey(Date.UTC(+m[1], +m[2] - 1, 1) - DAY_MS, "monthly");
  }
  if (cadence === "quarterly") {
    const m = /^(\d{4})-Q([1-4])$/.exec(key);
    if (!m) return null;
    return recurringPeriodKey(Date.UTC(+m[1], (+m[2] - 1) * 3, 1) - DAY_MS, "quarterly");
  }
  return null;
}
