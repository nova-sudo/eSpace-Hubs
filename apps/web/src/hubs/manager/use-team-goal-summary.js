"use client";

/**
 * Manager Hub — team-wide goal-tracking rollup, one request:
 * GET /manager/team-summary returns every direct report's goal-health
 * summary (the board groups are omitted; this page only needs counts).
 * Replaces the browser fanning out one goal-health call per report.
 *
 * Returns { loading, error, totals, perReport }, where perReport is a
 * Map<userId, { total, graded, needsAttention }> — needsAttention counts
 * goals that are ready-to-track but have no data yet, or need context
 * before they can start (needs_setup + no_data).
 */

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

const EMPTY_TOTALS = {
  goals: 0,
  graded: 0,
  needsSetup: 0,
  noData: 0,
  tracking: 0,
  auto: 0,
  delegatedToYou: 0,
};

export function useTeamGoalSummary(reports) {
  const ids = reports.map((r) => r.id).join(",");
  const [state, setState] = useState({
    loading: true,
    error: null,
    totals: EMPTY_TOTALS,
    perReport: new Map(),
  });

  useEffect(() => {
    if (reports.length === 0) {
      setState({ loading: false, error: null, totals: EMPTY_TOTALS, perReport: new Map() });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    void apiGet("/manager/team-summary").then((r) => {
      if (cancelled) return;
      if (!r.ok || !Array.isArray(r.data?.reports)) {
        setState((s) => ({ ...s, loading: false, error: "error" }));
        return;
      }
      const totals = { ...EMPTY_TOTALS };
      const perReport = new Map();
      for (const { id, summary: s } of r.data.reports) {
        totals.goals += s.total ?? 0;
        totals.graded += s.graded ?? 0;
        totals.needsSetup += s.needsSetup ?? 0;
        totals.noData += s.noData ?? 0;
        totals.tracking += s.tracking ?? 0;
        totals.auto += s.auto ?? 0;
        totals.delegatedToYou += s.delegatedToYou ?? 0;
        perReport.set(id, {
          total: s.total ?? 0,
          graded: s.graded ?? 0,
          needsAttention: (s.needsSetup ?? 0) + (s.noData ?? 0),
        });
      }
      setState({ loading: false, error: null, totals, perReport });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return state;
}
