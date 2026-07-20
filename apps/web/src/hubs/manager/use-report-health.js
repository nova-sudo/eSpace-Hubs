"use client";

/**
 * Manager Hub — one report's goal-health fetcher. Reads
 * GET /manager/reports/:userId/goal-health (managerId-scoped +
 * capability-gated server-side). Returns { loading, data, error, refresh },
 * where data is { user, summary, groups }. `refresh()` refetches in place
 * (e.g. after grading) without blanking the current board.
 */

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

export function useReportHealth(userId) {
  const [token, setToken] = useState(0);
  const [state, setState] = useState({
    loading: true,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!userId) {
      setState({ loading: false, data: null, error: "no-user" });
      return undefined;
    }
    let cancelled = false;
    // Full loading state only on the first load; a refresh keeps the
    // prior board visible while it refetches.
    setState((s) => ({ loading: s.data == null, data: s.data, error: null }));
    (async () => {
      const r = await apiGet(
        `/manager/reports/${encodeURIComponent(userId)}/goal-health`,
      );
      if (cancelled) return;
      if (r.ok) {
        setState({ loading: false, data: r.data ?? null, error: null });
      } else {
        setState((s) => ({ loading: false, data: s.data, error: r.error ?? "error" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, token]);

  const refresh = useCallback(() => setToken((t) => t + 1), []);
  return { ...state, refresh };
}
