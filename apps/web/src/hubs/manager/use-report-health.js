"use client";

/**
 * Manager Hub — one report's goal-health fetcher. Reads
 * GET /manager/reports/:userId/goal-health (managerId-scoped +
 * capability-gated server-side). Returns { loading, data, error, refresh },
 * where data is { user, summary, groups }. `refresh()` refetches in place
 * (e.g. after grading) without blanking the current board.
 */

import { useFetchOnce } from "./use-fetch-once";

export function useReportHealth(userId) {
  // SWR-keyed by URL: switching reports never shows the previous person's
  // board, a refresh keeps the current board visible while it refetches,
  // and a grade's revalidateManagerData(userId) refreshes it.
  const { loading, data, error, refresh } = useFetchOnce(
    userId ? `/manager/reports/${encodeURIComponent(userId)}/goal-health` : null,
  );
  return { loading, data, error: userId ? error : "no-user", refresh };
}
