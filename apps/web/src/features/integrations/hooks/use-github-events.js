"use client";

import { githubApi, normalizeGithubEvents } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { isoDaysAgo } from "@/lib/date";

/**
 * Current user's GitHub public events, normalized to the GitLab event shape
 * (action_name / target_type / created_at) the metrics expect.
 *
 * Note: GitHub caps `/users/:u/events/public` at ~300 events or ~90 days
 * regardless of date filter, so very long windows will silently clamp.
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
