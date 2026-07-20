"use client";

/**
 * Manager Hub — one report's goal-health fetcher. Reads
 * GET /manager/reports/:userId/goal-health (managerId-scoped +
 * capability-gated server-side). Returns { loading, data, error }, where
 * data is { user, summary, groups }.
 */

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

export function useReportHealth(userId) {
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
    setState({ loading: true, data: null, error: null });
    (async () => {
      const r = await apiGet(
        `/manager/reports/${encodeURIComponent(userId)}/goal-health`,
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
  }, [userId]);

  return state;
}
