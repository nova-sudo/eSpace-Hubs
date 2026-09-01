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
  useGithubReviewCounts,
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

/**
 * F5 — data honesty. One provenance record rides along with every metric
 * so widgets can render a chip saying what the number is actually made of
 * instead of presenting a sample with full confidence:
 *   sample    — rows the number is computed from (null while loading)
 *   unit      — what a row is ("MRs", "tickets", "builds")
 *   window    — the window genuinely covered (the YTD label)
 *   fetchedAt — epoch ms the underlying fetch last resolved (null = never)
 *   truncated — a known fetch/hydration cap was hit; the number is partial
 *   note      — human explanation of the cap, for the chip tooltip
 *   error     — the fetch failed; the rendered number is stale or absent
 */
function provenanceFor({ sample, unit, window, fetchedAt, truncated = false, note = null, error = null }) {
  return {
    sample: sample ?? null,
    unit,
    window,
    fetchedAt: fetchedAt ?? null,
    truncated: Boolean(truncated),
    note: truncated ? note : null,
    error: Boolean(error),
  };
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

  // Window guard: GitLab pages merged MRs by `updated_after` (not a
  // merged-date filter), so a pre-Jan-1 MR that was touched this year
  // leaks into the fetch. Every merged-MR metric must slice to
  // `merged_at` within the YTD window or the counts include prior-year
  // work and never respond to the window at all (the frozen "130/9"
  // first-pass bug). Same guard the evidence page applies in
  // `goal-readings.js`.
  const windowedMerged = filteredMerged
    ? mergedWithin(filteredMerged, days)
    : null;

  // AVG_ROUNDS and FIRST_PASS_RATE read `user_notes_count`, which the
  // GitHub search normaliser fills with issue comments only — hydrate
  // those rows with real review-comment counts (capped N+1, see hook).
  const needsNotes =
    metric === SOURCE_METRICS.AVG_ROUNDS ||
    metric === SOURCE_METRICS.FIRST_PASS_RATE;
  const reviewCounts = useGithubReviewCounts(
    needsNotes ? windowedMerged : null,
  );

  if (!source || !metric) {
    return {
      data: null,
      isLoading: false,
      error: null,
      windowDays: days,
      windowLabel,
      provenance: null,
    };
  }

  // GitHub's PR-notes hydration cap (mirrors useGithubReviewCounts.CAP):
  // rows beyond it keep the search-derived issue-comment counts, which
  // undercount review feedback — the exact bug behind the frozen "130
  // clean / 9 ping-pong" reading.
  const notesNote =
    reviewCounts.beyondCap > 0
      ? `Review comments hydrated for the 30 most recent GitHub PRs; ${reviewCounts.beyondCap} older PR${reviewCounts.beyondCap === 1 ? "" : "s"} still use issue-comment counts (undercounted).`
      : null;

  // Compute-on-demand — cheap, and keeps this file pure-ish.
  if (metric === SOURCE_METRICS.MERGED_COUNT) {
    const count = windowedMerged ? windowedMerged.length : null;
    const trend = windowedMerged
      ? mergedTrend(windowedMerged, 8).map((b) => b.n)
      : [];
    return {
      data: { count, trend, rawMrs: windowedMerged || [] },
      isLoading: merged.isLoading,
      error: merged.error,
      windowDays: days,
      windowLabel,
      provenance: provenanceFor({
        sample: windowedMerged ? windowedMerged.length : null,
        unit: "MRs",
        window: windowLabel,
        fetchedAt: merged.fetchedAt,
        error: merged.error,
      }),
    };
  }

  if (metric === SOURCE_METRICS.AVG_ROUNDS) {
    const mrs = reviewCounts.data || [];
    const value = mrs.length > 0 ? avgReviewerComments(mrs) : null;
    return {
      data: { value, rawMrs: mrs },
      isLoading: merged.isLoading || reviewCounts.isLoading,
      error: merged.error || reviewCounts.error,
      windowDays: days,
      windowLabel,
      provenance: provenanceFor({
        sample: windowedMerged ? mrs.length : null,
        unit: "MRs",
        window: windowLabel,
        fetchedAt: merged.fetchedAt,
        truncated: reviewCounts.beyondCap > 0,
        note: notesNote,
        error: merged.error || reviewCounts.error,
      }),
    };
  }

  if (metric === SOURCE_METRICS.MEDIAN_TURNAROUND) {
    const mrs = windowedMerged || [];
    const median = mrs.length > 0 ? medianTurnaroundDays(mrs) : null;
    const histogram = turnaroundHistogram(mrs);
    return {
      data: { median, histogram, rawMrs: mrs },
      isLoading: merged.isLoading,
      error: merged.error,
      windowDays: days,
      windowLabel,
      provenance: provenanceFor({
        sample: windowedMerged ? mrs.length : null,
        unit: "MRs",
        window: windowLabel,
        fetchedAt: merged.fetchedAt,
        error: merged.error,
      }),
    };
  }

  if (metric === SOURCE_METRICS.LINKAGE_PCT) {
    const mrs = windowedMerged || [];
    const value = mrs.length > 0 ? linkagePct(mrs) : null;
    return {
      data: { ...(value || {}), rawMrs: mrs },
      isLoading: merged.isLoading,
      error: merged.error,
      windowDays: days,
      windowLabel,
      provenance: provenanceFor({
        sample: windowedMerged ? mrs.length : null,
        unit: "MRs",
        window: windowLabel,
        fetchedAt: merged.fetchedAt,
        error: merged.error,
      }),
    };
  }

  if (metric === SOURCE_METRICS.FIRST_PASS_RATE) {
    // FIRST_PASS_RATE reads the same merged-MR list as MERGED_COUNT /
    // LINKAGE_PCT; the metric just slices the array differently
    // (clean ≤1-comment PRs vs. ping-pong ones). Returning the same
    // `{ pct, clean, pingPong, rawMrs }` triple lets the widget render
    // a familiar headline + bar without inventing new shape.
    const mrs = reviewCounts.data || [];
    const value = mrs.length > 0 ? firstPassRatePct(mrs) : null;
    return {
      data: { ...(value || {}), rawMrs: mrs },
      isLoading: merged.isLoading || reviewCounts.isLoading,
      error: merged.error || reviewCounts.error,
      windowDays: days,
      windowLabel,
      provenance: provenanceFor({
        sample: windowedMerged ? mrs.length : null,
        unit: "MRs",
        window: windowLabel,
        fetchedAt: merged.fetchedAt,
        truncated: reviewCounts.beyondCap > 0,
        note: notesNote,
        error: merged.error || reviewCounts.error,
      }),
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
      provenance: buildProvenance(buildEvents, events, windowLabel),
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
      provenance: buildProvenance(buildEvents, events, windowLabel),
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
      provenance: buildProvenance(buildEvents, events, windowLabel),
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
    // Jira's fetch is a 50-row sample of the most recently UPDATED
    // tickets, and the JQL excludes tickets resolved >90 days ago — a
    // "YTD" label without this note is exactly the false confidence F5
    // exists to fix.
    const jiraTruncated =
      tickets.length >= 50 ||
      (typeof jira.data?.total === "number" && jira.data.total > tickets.length);
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
      provenance: provenanceFor({
        sample: jira.data ? resolvedInWindow.length : null,
        unit: "tickets",
        window: windowLabel,
        fetchedAt: jira.fetchedAt,
        truncated: true,
        note: jiraTruncated
          ? "Jira fetch caps at the 50 most recently updated tickets, and tickets resolved more than 90 days ago are excluded — this is a sample, not the full year."
          : "Tickets resolved more than 90 days ago are excluded from the Jira fetch — this may not cover the full year.",
        error: jira.error,
      }),
    };
  }

  return {
    data: null,
    isLoading: false,
    error: new Error(`Unknown metric: ${metric}`),
    windowDays: days,
    windowLabel,
    provenance: null,
  };
}

/**
 * Shared provenance for the three CI/CD metrics: both providers hard-cap
 * at the last 100 builds/runs, so a full page means older activity inside
 * the window was silently dropped.
 */
function buildProvenance(buildEvents, events, windowLabel) {
  return provenanceFor({
    sample: events.length,
    unit: "builds",
    window: windowLabel,
    fetchedAt: buildEvents.fetchedAt,
    truncated: buildEvents.truncated,
    note: buildEvents.truncated
      ? "Fetch caps at the last 100 builds/runs — older activity inside the window is not counted."
      : null,
    error: buildEvents.error,
  });
}
