"use client";

/**
 * Single point of translation between `spec.source` and a concrete data hook.
 *
 * Why centralize?
 *   - AUTO widgets would otherwise each import their own integration hooks,
 *     duplicating the "window → sinceIso" math and the combined/single
 *     provider routing. Centralizing isolates that logic behind ONE hook
 *     and keeps widgets tiny + swappable.
 *   - Adding a new source metric is one `case` in `applyMetric()` plus a
 *     one-line entry in `PROVIDER_ROUTES`.
 *
 * Contract:
 *   const { data, isLoading, error, windowDays } = useDataSource(spec.source);
 *   `data` is the shape the widget cares about (e.g. a number for
 *   merged_count, a histogram for turnaround). Each widget knows what to
 *   expect based on `spec.source.metric`.
 */

import { isoDaysAgo } from "@/lib/date";
import {
  useCombinedMergedSince,
  useGitlabMergedSince,
  useGithubMergedSince,
  useJiraTickets,
  avgReviewerComments,
  linkagePct,
  medianTurnaroundDays,
  mergedWithin,
  mergedTrend,
  turnaroundHistogram,
  resolvedTicketsInWindow,
  medianTicketCycleDays,
  ticketCycleHistogram,
  filterMrsByRepo,
  SOURCE_METRICS,
} from "./source-deps";

/** Map a spec window → a day count we can snap isoDaysAgo to. */
export function windowToDays(window) {
  switch (window) {
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "quarter":
      return 90; // approximate; widgets can override if they care
    default:
      return 30;
  }
}

/** Resolve provider → the "merged since" hook. */
function useMergedByProvider(provider, sinceIso) {
  const combined = useCombinedMergedSince(
    provider === "combined" ? sinceIso : null,
  );
  const gitlab = useGitlabMergedSince(
    provider === "gitlab" ? sinceIso : null,
  );
  const github = useGithubMergedSince(
    provider === "github" ? sinceIso : null,
  );
  if (provider === "combined") return combined;
  if (provider === "gitlab") return gitlab;
  if (provider === "github") return github;
  // Unknown provider — treat as combined for graceful degradation.
  return combined;
}

/**
 * The main hook. One call per AUTO widget; returns the already-computed
 * scalar/histogram the widget needs.
 *
 * Important: we call every potentially-useful underlying hook
 * unconditionally (React hook rules). We pass `null` as `since` to the
 * ones we don't need so they short-circuit inside useSwrIf.
 */
export function useDataSource(source) {
  const days = windowToDays(source?.window);
  // The isoDaysAgo helper snaps to UTC midnight — stable within a calendar
  // day, so SWR cache keys don't thrash across renders.
  const sinceIso = isoDaysAgo(days);

  // We only need Jira for JIRA-based metrics; call conditionally via a
  // separate hook that already handles "skip when not connected".
  const jira = useJiraTickets();

  const metric = source?.metric;
  const provider = source?.provider || "combined";
  // Optional per-spec repo scope. When `spec.source.filter.repo` is set,
  // the merged-MR list is filtered to only that "owner/name" /
  // "group/project" slug BEFORE the metric math runs. Null/empty leaves
  // the cross-repo behaviour intact (the old default).
  const repoFilter = source?.filter?.repo || null;

  // One pair of merged-list hooks serves merged_count, avg_rounds,
  // median_turnaround, and linkage_pct.
  const merged = useMergedByProvider(provider, sinceIso);
  const filteredMerged = repoFilter
    ? filterMrsByRepo(merged.data, repoFilter)
    : merged.data;

  if (!source || !metric) {
    return { data: null, isLoading: false, error: null, windowDays: days };
  }

  // Compute-on-demand — cheap, and keeps this file pure-ish.
  if (metric === SOURCE_METRICS.MERGED_COUNT) {
    const count = filteredMerged
      ? mergedWithin(filteredMerged, days).length
      : null;
    const trend = filteredMerged
      ? mergedTrend(filteredMerged, 8).map((b) => b.n)
      : [];
    return {
      data: { count, trend, rawMrs: filteredMerged || [] },
      isLoading: merged.isLoading,
      error: merged.error,
      windowDays: days,
    };
  }

  if (metric === SOURCE_METRICS.AVG_ROUNDS) {
    const mrs = filteredMerged || [];
    const value = mrs.length > 0 ? avgReviewerComments(mrs) : null;
    return {
      data: { value, rawMrs: mrs },
      isLoading: merged.isLoading,
      error: merged.error,
      windowDays: days,
    };
  }

  if (metric === SOURCE_METRICS.MEDIAN_TURNAROUND) {
    const mrs = filteredMerged || [];
    const median = mrs.length > 0 ? medianTurnaroundDays(mrs) : null;
    const histogram = turnaroundHistogram(mrs);
    return {
      data: { median, histogram, rawMrs: mrs },
      isLoading: merged.isLoading,
      error: merged.error,
      windowDays: days,
    };
  }

  if (metric === SOURCE_METRICS.LINKAGE_PCT) {
    const mrs = filteredMerged || [];
    const value = mrs.length > 0 ? linkagePct(mrs) : null;
    return {
      data: { ...(value || {}), rawMrs: mrs },
      isLoading: merged.isLoading,
      error: merged.error,
      windowDays: days,
    };
  }

  if (metric === SOURCE_METRICS.TICKET_CYCLE_TIME) {
    // `useJiraTickets()` returns the raw Jira search envelope:
    //   { issues: [...], total, ... }
    // Widgets expect a plain array, so unwrap here. Fall back to [] so
    // downstream `for ... of` never sees the envelope object (which was
    // causing the "tickets is not iterable" widget crash).
    const tickets = Array.isArray(jira.data?.issues) ? jira.data.issues : [];
    // Cycle time uses `resolutiondate − created` for tickets RESOLVED
    // inside the spec window (`sinceIso`). This is the simple MVP cycle
    // time — a richer "in-progress → done" version would need the Jira
    // changelog endpoint, which we don't fetch yet.
    const resolvedInWindow = resolvedTicketsInWindow(tickets, sinceIso);
    const median = medianTicketCycleDays(resolvedInWindow);
    const histogram = ticketCycleHistogram(resolvedInWindow);
    return {
      data: {
        median,
        histogram,
        resolvedCount: resolvedInWindow.length,
        totalCount: tickets.length,
        tickets,
      },
      isLoading: jira.isLoading,
      error: jira.error,
      windowDays: days,
    };
  }

  return {
    data: null,
    isLoading: false,
    error: new Error(`Unknown metric: ${metric}`),
    windowDays: days,
  };
}
