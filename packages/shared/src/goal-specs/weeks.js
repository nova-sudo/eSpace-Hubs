/**
 * The Sunday-anchored WORK WEEK, in UTC — the one week model shared by the
 * cadence windows (windows.js), the snapshot store and the API scheduler.
 *
 * eSpace's work week runs Sunday → Thursday (Friday + Saturday are the
 * weekend). A "week" here is the whole Sun 00:00 → next Sun 00:00 span: the
 * weekend belongs to the week it closes, so an entry logged on a Friday still
 * files under the week the user just worked.
 *
 * Numbering is the canonical rule from apps/web/src/lib/date.js `weekNumber`
 * (and the scheduler's `sunWeekNumberUtc`): the week containing 1 January is
 * week 1 — even when 1 January isn't a Sunday — and every later Sunday starts
 * the next week. So "W39" names the same seven days on the snapshots page, in
 * the scheduler and on a weekly tracker's stepper.
 *
 * UTC throughout, like every other window boundary in windows.js: window
 * starts/ends and keys must not shift with the viewer's timezone. The web's
 * lib/date.js reads LOCAL calendar components; for a Cairo browser that can
 * only disagree within 2–3 hours of Sunday midnight (the same accepted
 * imprecision the scheduler documents).
 *
 * Pure — no React, no IO.
 */

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

function utcDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** UTC midnight of the Sunday on/before `ms`. */
export function sundayOnOrBeforeUtc(ms) {
  const day = utcDay(ms);
  return day - new Date(day).getUTCDay() * DAY_MS;
}

/** Sunday-anchored week number (1-indexed, week 1 contains 1 Jan) of `ms`, UTC. */
export function sunWeekNumberUtc(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const jan1Dow = new Date(Date.UTC(y, 0, 1)).getUTCDay();
  const week1Sunday = Date.UTC(y, 0, 1 - jan1Dow);
  return Math.floor(Math.round((utcDay(ms) - week1Sunday) / DAY_MS) / 7) + 1;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** "W39" — the short week label, identical to lib/date.js `weekLabel`. */
export function weekLabelUtc(ms) {
  return `W${pad2(sunWeekNumberUtc(ms))}`;
}

/** "W39-2026" — the snapshot week KEY shape (lib/date.js `weekKey`). */
export function weekKeyUtc(ms) {
  return `${weekLabelUtc(ms)}-${new Date(ms).getUTCFullYear()}`;
}

/**
 * The key the goal-locks `currentWindowKey` wrote for weekly/biweekly goals
 * before cadence windows were Sunday-anchored: "YYYY-Wnn", zero-padded, from
 * the Sunday week number of the date. For calendar-year cycles this names
 * exactly the same week as the window keyed `YYYY-W<n>` today, so it is read
 * as an alias of that window (see windows.js `windowKeyAliases`).
 */
export function legacyPaddedWeekKeyUtc(ms) {
  return `${new Date(ms).getUTCFullYear()}-W${pad2(sunWeekNumberUtc(ms))}`;
}
