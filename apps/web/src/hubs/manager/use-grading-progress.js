"use client";

/**
 * Manager grading progress for one period (default: this calendar year):
 * GET /manager/grading-progress?periodKey=2026 →
 *   { periodKey, totals, reports: [{ id, displayName, total, graded,
 *     byTier, acknowledged, disputed }] }
 *
 * "Graded" counts MANAGER grades filed under the period (the verdict
 * history's periodKey), latest per goal — not AI tiers. Returns
 * { loading, error, periodKey, totals, reports, byId }.
 */

import { useMemo } from "react";
import { useFetchOnce } from "./use-fetch-once";

export function currentPeriodKey() {
  return String(new Date().getFullYear());
}

export function useGradingProgress(periodKey = currentPeriodKey()) {
  const { loading, data, error, refresh } = useFetchOnce(
    `/manager/grading-progress?periodKey=${encodeURIComponent(periodKey)}`,
  );
  const reports = useMemo(
    () => (Array.isArray(data?.reports) ? data.reports : []),
    [data],
  );
  const byId = useMemo(() => new Map(reports.map((r) => [r.id, r])), [reports]);
  return {
    loading,
    error,
    periodKey: data?.periodKey ?? periodKey,
    totals: data?.totals ?? null,
    reports,
    byId,
    refresh,
  };
}
