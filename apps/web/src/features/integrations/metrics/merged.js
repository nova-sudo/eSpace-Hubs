import { DAY_MS } from "@/lib/date";

/** Merges whose merged_at is within [now - days, now]. */
export function mergedWithin(mrs = [], days = 7) {
  const cutoff = Date.now() - days * DAY_MS;
  return mrs.filter(
    (m) => m.merged_at && new Date(m.merged_at).getTime() >= cutoff,
  );
}

/** Count merged-this-week and the delta vs. previous week. */
export function mergedThisWeek(mrs = []) {
  const now = Date.now();
  const week = 7 * DAY_MS;
  const thisW = mrs.filter(
    (m) => m.merged_at && new Date(m.merged_at).getTime() >= now - week,
  ).length;
  const lastW = mrs.filter((m) => {
    if (!m.merged_at) return false;
    const t = new Date(m.merged_at).getTime();
    return t < now - week && t >= now - 2 * week;
  }).length;
  return { count: thisW, delta: thisW - lastW };
}

/**
 * 8 × one-week buckets of counts, oldest → newest.
 *
 * Buckets are anchored to Sunday-start calendar weeks so the rightmost
 * bucket ("this week") matches the team's Sun → Thu work-week label and
 * lines up with `weekLabel(today)` in the hero. Each bucket spans Sun
 * 00:00 (local) → next Sun 00:00.
 */
export function mergedTrend(mrs = [], weeks = 8) {
  // Anchor on Sun 00:00 local of the current week, then walk back N weeks.
  const anchor = new Date();
  anchor.setDate(anchor.getDate() - anchor.getDay());
  anchor.setHours(0, 0, 0, 0);
  const anchorMs = anchor.getTime();
  const WEEK_MS = 7 * DAY_MS;

  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = anchorMs - i * WEEK_MS;
    const end = start + WEEK_MS;
    const n = mrs.filter((m) => {
      if (!m.merged_at) return false;
      const t = new Date(m.merged_at).getTime();
      return t >= start && t < end;
    }).length;
    buckets.push({ n, weekIndex: weeks - i });
  }
  return buckets;
}
