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

import { EMPTY_LIST, useFetchOnce } from "./use-fetch-once";

export function useManagerReports() {
  const { loading, data, error } = useFetchOnce("/manager/reports");
  return {
    loading,
    reports: Array.isArray(data?.reports) ? data.reports : EMPTY_LIST,
    error,
  };
}
