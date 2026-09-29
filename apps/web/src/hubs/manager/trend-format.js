/**
 * Pure helpers for the manager's snapshot trend surfaces — turn a weekly
 * series (oldest first, from /manager/team-trends or
 * /manager/reports/:userId/snapshots) into sparkline data and one line
 * of copy. No React, no I/O.
 */

/** The merged-PR values a sparkline can draw — unknown weeks dropped. */
export function mergedSeries(series) {
  return (series ?? [])
    .map((p) => p.merged)
    .filter((n) => typeof n === "number" && Number.isFinite(n));
}

/**
 * The latest week as a sentence: "5 merged PRs · 3 of 4 goals met, W38".
 * Null when there's no snapshot at all.
 */
export function latestWeekLine(series) {
  const last = series?.[series.length - 1];
  if (!last) return null;
  const parts = [];
  if (typeof last.merged === "number") {
    parts.push(`${last.merged} merged PR${last.merged === 1 ? "" : "s"}`);
  }
  if (last.goalsTracked > 0) {
    parts.push(`${last.goalsMet} of ${last.goalsTracked} goals met`);
  }
  const week = String(last.week ?? "").replace(/-\d{4}$/, "");
  return `${parts.join(" · ") || "Snapshot taken"}${week ? `, ${week}` : ""}`;
}
