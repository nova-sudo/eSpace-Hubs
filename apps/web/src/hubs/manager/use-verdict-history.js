"use client";

/**
 * Manager Hub — one goal's grade history + the report's acknowledgement.
 * Reads GET /manager/reports/:userId/goals/:goalId/verdicts (append-only
 * history, oldest first, plus the current grade with its `ack`).
 *
 * Lazy like useGoalDetail: only fetches while `enabled` (the drawer is
 * open). SWR-keyed by the URL, so a grade's `revalidateManagerData(userId)`
 * refreshes it. Returns { loading, current, history, error }.
 */

import { EMPTY_LIST, useFetchOnce } from "./use-fetch-once";

export function verdictHistoryPath(userId, goalId) {
  return `/manager/reports/${encodeURIComponent(userId)}/goals/${encodeURIComponent(
    goalId,
  )}/verdicts`;
}

export function useVerdictHistory(userId, goalId, enabled = true) {
  const { loading, data, error } = useFetchOnce(
    enabled && userId && goalId ? verdictHistoryPath(userId, goalId) : null,
  );
  return {
    loading,
    current: data?.current ?? null,
    history: Array.isArray(data?.history) ? data.history : EMPTY_LIST,
    error,
  };
}
