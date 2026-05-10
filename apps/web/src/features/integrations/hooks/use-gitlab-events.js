"use client";

import { gitlabApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { isoDaysAgo } from "@/lib/date";

/**
 * Fetch current user's GitLab events since a given Date (or days-ago number).
 * Passing a Date lets dashboard tiles share a single fetch for comparison
 * windows (current + previous period).
 */
export function useGitlabEventsSince(since) {
  const { isConnected } = useIntegrations();
  const iso =
    since instanceof Date
      ? since.toISOString()
      : typeof since === "number"
        ? isoDaysAgo(since)
        : since;
  return useSwrIf(isConnected("gitlab"), `gitlab:events:${iso}`, () =>
    gitlabApi.myEventsSince(iso),
  );
}

export function useGitlabEvents(days = 30) {
  return useGitlabEventsSince(days);
}
