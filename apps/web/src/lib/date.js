const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ISO timestamp for N days ago, snapped to start-of-UTC-day.
 *
 * Without this snap, every render calling `isoDaysAgo(14)` produces a new
 * millisecond — which tiles then pass to SWR as part of the cache key, so
 * every tile fires a fresh request every render. Snapping to midnight UTC
 * keeps the key stable within the same day and lets SWR dedupe across tiles.
 */
export function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * DAY_MS);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Return the most recent Sunday at local midnight as an ISO string.
 *
 * Why Sunday-start: this app is built for an Egypt-based team whose work
 * week runs Sun → Thu (Fri/Sat are the weekend). Defining "the week" with
 * a Mon-start boundary would split work weeks across two label buckets.
 *
 * Day numbering: `Date#getDay()` returns 0=Sun, 1=Mon, …, 6=Sat. So for
 * a Sun-start week the offset back to start is just `day`.
 */
export function isoStartOfWeek(date = new Date()) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * "Wnn" — week number anchored to Sunday-start weeks.
 *
 * Rule: the week containing Jan 1 is week 1, even when Jan 1 isn't a
 * Sunday (the partial week before still counts as week 1). Subsequent
 * weeks count up by one each Sunday.
 *
 * Implementation: shift the day-of-year by Jan 1's weekday so that day 0
 * always falls on a Sunday, then divide by 7 with ceiling to get the
 * 1-indexed week number.
 *
 * Example for 2026 (Jan 1 = Thursday):
 *   week 1 covers Sun Dec 28 2025 → Sat Jan 3 2026
 *   week 2 covers Sun Jan 4 → Sat Jan 10
 *   …
 *   Sun Apr 26 2026 lands in week 18.
 */
export function weekLabel(date = new Date()) {
  const d = new Date(date);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((d - yearStart) / DAY_MS) + 1; // 1-indexed
  const jan1Weekday = yearStart.getDay(); // 0 = Sun
  const week = Math.ceil((dayOfYear + jan1Weekday) / 7);
  return `W${String(week).padStart(2, "0")}`;
}

export function shortDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function fullDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Resolve a Sun → Thu work-week from a Wnn label (current year).
 *
 * Inputs: "W17" or "W17-2026" — the year suffix is optional and
 * defaults to the current calendar year (matches how the snapshot
 * store keys its rows today).
 *
 * Returns `{ start, end, weekLabel }` — the same triple the
 * auto-snapshotter and backfill enumerator produce. Suitable for
 * direct hand-off to `synthesiseWeek`.
 *
 * Returns null when the label can't be parsed.
 */
export function weekRangeFromLabel(label) {
  if (typeof label !== "string") return null;
  const m = label.trim().match(/^W(\d{1,2})(?:-(\d{4}))?$/i);
  if (!m) return null;
  const weekNum = Number(m[1]);
  const year = m[2] ? Number(m[2]) : new Date().getFullYear();
  if (!Number.isFinite(weekNum) || weekNum < 1 || weekNum > 53) return null;

  // Invert weekLabel(): find the Sunday of the requested week. weekLabel
  // counts week 1 as the week containing Jan 1 (with the partial week
  // before Jan 1 still grouped under week 1). Working backwards: the
  // Sunday of week N is at dayOfYear `7*(N-1) - jan1Weekday + 1`.
  const yearStart = new Date(year, 0, 1);
  const jan1Weekday = yearStart.getDay(); // 0=Sun
  const dayOfYearOfSunday = 7 * (weekNum - 1) - jan1Weekday + 1;
  const sunday = new Date(year, 0, dayOfYearOfSunday);
  sunday.setHours(0, 0, 0, 0);

  const friday = new Date(sunday);
  friday.setDate(sunday.getDate() + 5); // Sun + 5 = Friday 00:00 (= Thu EOD)

  return {
    start: sunday,
    end: friday,
    weekLabel: weekLabel(new Date(sunday.getTime() + 3 * DAY_MS)),
  };
}

/**
 * Resolve the most recent COMPLETED Sun → Thu work-week (no in-progress
 * weeks). Shares logic with use-auto-snapshot's resolver but lives here
 * so non-React callers (URL defaulting, link builders) can use it.
 */
export function resolveCompletedWorkWeek(now = new Date()) {
  const d = new Date(now);
  const day = d.getDay();
  let daysSinceFriday;
  if (day >= 5) {
    daysSinceFriday = day - 5; // Fri=0, Sat=1
  } else {
    daysSinceFriday = day + 2; // Sun=2, Mon=3, ..., Thu=6
  }
  const friday = new Date(d);
  friday.setDate(d.getDate() - daysSinceFriday);
  friday.setHours(0, 0, 0, 0);
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() - 5);
  return {
    start: sunday,
    end: friday,
    weekLabel: weekLabel(new Date(sunday.getTime() + 3 * DAY_MS)),
  };
}

/**
 * Mid-week timestamp (Tuesday 12:00 local) for a given week label.
 * Useful when writing a goal-input that should be attributed to the
 * selected week — putting it at mid-week keeps the ts well inside the
 * Sun → Fri window so cadence-window logic doesn't have to worry about
 * edge cases.
 */
export function midWeekTs(label) {
  const r = weekRangeFromLabel(label);
  if (!r) return null;
  const mid = new Date(r.start);
  mid.setDate(r.start.getDate() + 2); // Tue
  mid.setHours(12, 0, 0, 0);
  return mid.getTime();
}

/**
 * Compare two "Wnn" labels for sort order. Treats them as 1..53 within
 * the same year. (Year-suffixed labels compare lexicographically and
 * still order correctly across full years.)
 */
export function compareWeekLabels(a, b) {
  return (a || "").localeCompare(b || "");
}

export { DAY_MS };
