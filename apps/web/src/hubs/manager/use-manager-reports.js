"use client";

/**
 * Manager Hub — direct-reports fetcher. Reads GET /manager/reports (the
 * manager's team; managerId-scoped + capability-gated server-side) once
 * on mount. Returns { loading, reports, error }.
 *
 * Kept local to the manager hub for now; when P1 adds per-report goal
 * health this graduates into a shared-domain hook parameterised by a
 * target userId. See docs/manager-hub-plan.md.
 */

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

export function useManagerReports() {
  const [state, setState] = useState({
    loading: true,
    reports: [],
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await apiGet("/manager/reports");
      if (cancelled) return;
      if (r.ok) {
        setState({ loading: false, reports: r.data?.reports ?? [], error: null });
      } else {
        setState({ loading: false, reports: [], error: r.error ?? "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
