"use client";

import { useMemo } from "react";
import { githubApi, normalizeGithubEvents } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import {
  canonicalEventsSinceIso,
  filterEventsSince,
  resolveFetchWindow,
} from "./provider-windows";

/**
 * Current user's GitHub public events, normalized to the GitLab event shape
 * (action_name / target_type / created_at) the metrics expect.
 *
 * Caps + pagination: GitHub's `/users/:u/events/public` returns at most 300
 * events (3 pages × 100) and ~90 days of history. The api client paginates
 * up to that cap with early termination when the page count or the caller's
 * `since` cutoff is exceeded — so YTD / Year / 90d views still surface
 * everything available, not just page 1.
 *
 * For windows older than 90 days the events feed is irrecoverable from this
 * endpoint; tiles fed by it (Activity / Signal / Heatmap / Reviews-given /
 * Backfill) will read 0 for those older weeks. Backfill marks those as
 * `partial: true` with `gaps: ["events"]`.
 */
export function useGithubEventsSince(since) {
  const { isConnected } = useIntegrations();
  // The feed itself stops at ~90 days, so EVERY window — even YTD — is
  // served from the one canonical 90-day walk and trimmed client-side.
  // (A YTD walk and a 90d walk read the exact same pages.) `null` skips.
  const win = resolveFetchWindow(since, [canonicalEventsSinceIso()]);
  const filterIso = win?.filterIso ?? null;
  const fetchIso = win ? canonicalEventsSinceIso() : null;
  const swr = useSwrIf(isConnected("github") && Boolean(fetchIso), `github:events:${fetchIso}`, () =>
    githubApi.myEventsSince(fetchIso),
  );
  // Client-side trim to the requested window — GitHub's endpoint ignores date.
  const data = useMemo(
    () => (swr.data ? filterEventsSince(normalizeGithubEvents(swr.data), filterIso) : swr.data),
    [swr.data, filterIso],
  );
  return { ...swr, data };
}
