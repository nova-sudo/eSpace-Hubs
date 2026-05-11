"use client";

import { githubApi, normalizeGithubEvents } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { isoDaysAgo } from "@/lib/date";

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
  const iso =
    since instanceof Date
      ? since.toISOString()
      : typeof since === "number"
        ? isoDaysAgo(since)
        : since;
  const swr = useSwrIf(isConnected("github"), `github:events:${iso}`, () =>
    githubApi.myEventsSince(iso),
  );
  const all = swr.data ? normalizeGithubEvents(swr.data) : swr.data;
  // Client-side trim to the requested window — GitHub's endpoint ignores date.
  const cutoff = typeof iso === "string" ? new Date(iso).getTime() : null;
  const data =
    all && cutoff
      ? all.filter((e) => new Date(e.created_at).getTime() >= cutoff)
      : all;
  return { ...swr, data };
}
