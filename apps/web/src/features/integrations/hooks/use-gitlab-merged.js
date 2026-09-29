"use client";

import { gitlabApi, normalizeGitlabMerged } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { isoDaysAgo } from "@/lib/date";

/**
 * Fetch the user's merged MRs since a given Date (or days-ago number).
 * SWR caches per ISO key so two tiles asking for the same `since` share
 * one request.
 */
export function useGitlabMergedSince(since) {
  const { isConnected } = useIntegrations();
  const iso =
    since instanceof Date
      ? since.toISOString()
      : typeof since === "number"
        ? isoDaysAgo(since)
        : since;
  // `since = null` means "not needed" — skip rather than fetch with no date.
  return useSwrIf(isConnected("gitlab") && Boolean(iso), `gitlab:merged:${iso}`, () =>
    gitlabApi.myMergedSince(iso).then(normalizeGitlabMerged),
  );
}

// Convenience fixed-window hooks kept for backwards compat.
export function useGitlabMerged30d() {
  return useGitlabMergedSince(30);
}

export function useGitlabMerged90d() {
  return useGitlabMergedSince(90);
}
