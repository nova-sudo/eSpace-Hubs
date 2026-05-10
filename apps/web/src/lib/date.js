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

export { DAY_MS };
