"use client";

/**
 * Weekly snapshot headline series — the "is the team getting better"
 * read. Points are oldest week first:
 *   { week, capturedAt, capturedBy, partial, merged, reviews,
 *     goalsTracked, goalsMet }
 * `merged` / `reviews` are null for weeks the scheduler froze without
 * provider metrics.
 *
 *   useTeamTrends(weeks)          GET /manager/team-trends?weeks=
 *   useReportTrend(userId, weeks) GET /manager/reports/:userId/snapshots?weeks=
 */

import { EMPTY_LIST, useFetchOnce } from "./use-fetch-once";

export function useTeamTrends(weeks = 12) {
  const { loading, data, error } = useFetchOnce(`/manager/team-trends?weeks=${weeks}`);
  return {
    loading,
    error,
    reports: Array.isArray(data?.reports) ? data.reports : EMPTY_LIST,
  };
}

export function useReportTrend(userId, weeks = 12) {
  const { loading, data, error } = useFetchOnce(
    userId
      ? `/manager/reports/${encodeURIComponent(userId)}/snapshots?weeks=${weeks}`
      : null,
  );
  return { loading, error, series: Array.isArray(data?.series) ? data.series : EMPTY_LIST };
}
