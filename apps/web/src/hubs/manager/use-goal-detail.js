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

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

export function useGoalDetail(userId, goalId, enabled = true) {
  const [state, setState] = useState({
    loading: false,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !userId || !goalId) {
      setState({ loading: false, data: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    (async () => {
      const r = await apiGet(
        `/manager/reports/${encodeURIComponent(userId)}/goals/${encodeURIComponent(
          goalId,
        )}/detail`,
      );
      if (cancelled) return;
      if (r.ok) {
        setState({ loading: false, data: r.data ?? null, error: null });
      } else {
        setState({ loading: false, data: null, error: r.error ?? "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, goalId, enabled]);

  return state;
}
