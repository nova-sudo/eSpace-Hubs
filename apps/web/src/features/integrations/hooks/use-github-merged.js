"use client";

import { githubApi, normalizeGithubMergedSearch } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { isoDaysAgo } from "@/lib/date";

/**
 * Fetch current user's merged GitHub PRs since a given Date/days-ago number
 * and normalize them to GitLab merged-MR shape so the metrics layer can
 * consume them uniformly.
 */
export function useGithubMergedSince(since) {
  const { isConnected } = useIntegrations();
  const iso =
    since instanceof Date
      ? since.toISOString()
      : typeof since === "number"
        ? isoDaysAgo(since)
        : since;
  // `since = null` means "not needed" (use-data-source calls every provider
  // hook unconditionally) — without the iso guard it fired `merged:>=` and 422'd.
  const swr = useSwrIf(isConnected("github") && Boolean(iso), `github:merged:${iso}`, () =>
    githubApi.myMergedSince(iso),
  );
  return {
    ...swr,
    data: swr.data ? normalizeGithubMergedSearch(swr.data) : swr.data,
  };
}
