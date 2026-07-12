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

import { startOfYearIso, startOfYearMs, DAY_MS } from "@/lib/date";
import {
  useCombinedMergedSince,
  useGitlabMergedSince,
  useGithubMergedSince,
  useJiraTickets,
  useBuildEventsSince,
  avgReviewerComments,
  linkagePct,
  firstPassRatePct,
  medianTurnaroundDays,
  mergedWithin,
  mergedTrend,
  turnaroundHistogram,
  resolvedTicketsInWindow,
  medianTicketCycleDays,
  ticketCycleHistogram,
  filterMrsByRepo,
  deployFrequency,
  leadTimeStats,
  buildPassRate,
  SOURCE_METRICS,
} from "./source-deps";

/**
 * Legacy: map a spec window → a day count. Kept for back-compat with any
 * caller that still reads it, but useDataSource no longer uses it — every auto
 * metric is now measured year-to-date (see the hook), because the L2s are
 * annual goals and a rolling 30/90-day slice clipped the very work they track.
 */
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
  // Year-to-date window. The L2s are annual goals, so every auto metric is
  // measured Jan 1 → today rather than a rolling `spec.source.window` slice
  // (which left short-window goals reading "—"). `sinceIso` snaps to UTC
  // midnight of Jan 1 — constant all year, so SWR cache keys never thrash.
  // `days` is the YTD span (a rate denominator + the client-side merged
  // filter); `windowLabel` is what widgets render.
  const sinceIso = startOfYearIso();
  const days = Math.max(1, Math.ceil((Date.now() - startOfYearMs()) / DAY_MS));
  const windowLabel = `${new Date().getFullYear()} YTD`;

  // We only need Jira for JIRA-based metrics; call conditionally via a
  // separate hook that already handles "skip when not connected".
  const jira = useJiraTickets();

  // CI/CD events for DEPLOY_FREQUENCY / LEAD_TIME / BUILD_PASS_RATE.
  // The hook itself gates by provider + filter.job/repo and returns
  // an empty list when scope isn't set yet — safe to call
  // unconditionally on every render even when this spec is NOT a
  // CI/CD spec (React hook rules say all hooks run every render).
  const buildEvents = useBuildEventsSince(source, sinceIso);

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
    return { data: null, isLoading: false, error: null, windowDays: days, windowLabel };
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
      windowLabel,
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
      windowLabel,
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
      windowLabel,
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
      windowLabel,
    };
  }

  if (metric === SOURCE_METRICS.FIRST_PASS_RATE) {
    // FIRST_PASS_RATE reads the same merged-MR list as MERGED_COUNT /
    // LINKAGE_PCT; the metric just slices the array differently
    // (clean ≤1-comment PRs vs. ping-pong ones). Returning the same
    // `{ pct, clean, pingPong, rawMrs }` triple lets the widget render
    // a familiar headline + bar without inventing new shape.
    const mrs = filteredMerged || [];
    const value = mrs.length > 0 ? firstPassRatePct(mrs) : null;
    return {
      data: { ...(value || {}), rawMrs: mrs },
      isLoading: merged.isLoading,
      error: merged.error,
      windowDays: days,
      windowLabel,
    };
  }

  if (metric === SOURCE_METRICS.DEPLOY_FREQUENCY) {
    // BuildEvent[] from Jenkins (per-job) OR GitHub Actions (per-repo).
    // The hook returns `needsScope: true` until the user picks the
    // job/repo via the Review pane; the widget renders a scope-
    // picker affordance in that case.
    const events = buildEvents.data || [];
    const stats = deployFrequency(events, days);
    return {
      data: {
        ...stats,
        events,
        needsScope: buildEvents.needsScope,
      },
      isLoading: buildEvents.isLoading,
      error: buildEvents.error,
      windowDays: days,
      windowLabel,
    };
  }

  if (metric === SOURCE_METRICS.LEAD_TIME) {
    const events = buildEvents.data || [];
    const stats = leadTimeStats(events, days);
    return {
      data: {
        ...stats,
        events,
        needsScope: buildEvents.needsScope,
      },
      isLoading: buildEvents.isLoading,
      error: buildEvents.error,
      windowDays: days,
      windowLabel,
    };
  }

  if (metric === SOURCE_METRICS.BUILD_PASS_RATE) {
    const events = buildEvents.data || [];
    const stats = buildPassRate(events, days);
    return {
      data: {
        ...stats,
        events,
        needsScope: buildEvents.needsScope,
      },
      isLoading: buildEvents.isLoading,
      error: buildEvents.error,
      windowDays: days,
      windowLabel,
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
      windowLabel,
    };
  }

  return {
    data: null,
    isLoading: false,
    error: new Error(`Unknown metric: ${metric}`),
    windowDays: days,
    windowLabel,
  };
}
