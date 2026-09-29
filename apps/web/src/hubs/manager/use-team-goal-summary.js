"use client";

/**
 * Manager Hub — team-wide goal-tracking rollup, one request:
 * GET /manager/team-summary returns every direct report's goal-health
 * summary (the board groups are omitted; this page only needs counts).
 * Replaces the browser fanning out one goal-health call per report.
 *
 * Returns { loading, error, totals, perReport }, where perReport is a
 * Map<userId, { total, graded, needsSetup, noTracker, delegatedToYou,
 * byTier, byStatus, worst, lastEntryAt, openDisputes, packet,
 * needsAttention }>.
 *
 * Statuses are the SHARED model (`goalStatus`, computed server-side over
 * the same cadence windows the report's own pages use), so "Behind" here
 * is "Behind" on their Home. `worst` is the report's weakest measured goal
 * with its reason ("Behind · Gone quiet · 3 weeks…"); `needsAttention`
 * counts what a lead should look at: goals behind, open disagreements and
 * a packet they haven't opened.
 *
 * `byTier` is the achievement-tier histogram the API has always returned
 * per report. The team table draws it as a spread bar: "9 of 12 graded"
 * says how much work is done, the spread says what the work SAID.
 */

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

function emptyByTier() {
  return { not_achieved: 0, achieved: 0, over_achieved: 0, role_model: 0 };
}

const EMPTY_TOTALS = {
  goals: 0,
  graded: 0,
  needsSetup: 0,
  noTracker: 0,
  openDisputes: 0,
  newPackets: 0,
  noData: 0,
  tracking: 0,
  auto: 0,
  delegatedToYou: 0,
  byTier: emptyByTier(),
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
      const totals = { ...EMPTY_TOTALS, byTier: emptyByTier() };
      const perReport = new Map();
      for (const { id, summary: s } of r.data.reports) {
        totals.goals += s.total ?? 0;
        totals.graded += s.graded ?? 0;
        totals.needsSetup += s.needsSetup ?? 0;
        totals.noTracker += s.noTracker ?? 0;
        totals.openDisputes += s.openDisputes ?? 0;
        if (s.packet?.state === "new") totals.newPackets += 1;
        totals.noData += s.noData ?? 0;
        totals.tracking += s.tracking ?? 0;
        totals.auto += s.auto ?? 0;
        totals.delegatedToYou += s.delegatedToYou ?? 0;
        const byTier = { ...emptyByTier(), ...(s.byTier ?? {}) };
        for (const t of Object.keys(totals.byTier)) {
          totals.byTier[t] += byTier[t] ?? 0;
        }
        const behind = s.byStatus?.behind ?? 0;
        perReport.set(id, {
          total: s.total ?? 0,
          graded: s.graded ?? 0,
          needsAttention:
            behind + (s.openDisputes ?? 0) + (s.packet?.state === "new" ? 1 : 0),
          behind,
          needsSetup: s.needsSetup ?? 0,
          noTracker: s.noTracker ?? 0,
          byStatus: s.byStatus ?? {},
          worst: s.worst ?? null,
          lastEntryAt: s.lastEntryAt ?? null,
          openDisputes: s.openDisputes ?? 0,
          packet: s.packet ?? null,
          delegatedToYou: s.delegatedToYou ?? 0,
          byTier,
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
