"use client";

/**
 * Manager Hub — one goal's read-only review detail. Reads
 * GET /manager/reports/:userId/goals/:goalId/detail (managerId-scoped +
 * capability-gated server-side). Powers the read-only GoalWidget view in
 * the grading drawer: goal definition, tier criteria, logged evidence, and
 * the AI verdict.
 *
 * Fetches lazily — only when `enabled` (the drawer is open). Returns
 * { loading, data, error }. Re-fetches when the goal changes.
 */

import { useFetchOnce } from "./use-fetch-once";

export function useGoalDetail(userId, goalId, enabled = true) {
  const { loading, data, error } = useFetchOnce(
    enabled && userId && goalId
      ? `/manager/reports/${encodeURIComponent(userId)}/goals/${encodeURIComponent(
          goalId,
        )}/detail`
      : null,
  );
  return { loading, data, error };
}
