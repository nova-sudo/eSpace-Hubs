"use client";

import { useMemo } from "react";
import { githubApi, normalizeGithubMergedSearch } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import {
  canonicalMergedSinceIso,
  filterMergedSince,
  resolveFetchWindow,
} from "./provider-windows";

/**
 * Fetch current user's merged GitHub PRs since a given Date / days-ago
 * number / ISO string and normalize them to GitLab merged-MR shape so the
 * metrics layer can consume them uniformly.
 *
 * Every caller shares ONE fetch: the canonical long window (365d or YTD,
 * whichever reaches further — see `provider-windows.js`), sliced client-side
 * to the caller's `since`. Only a `since` older than that window gets its
 * own (local-midnight-snapped) key.
 */
export function useGithubMergedSince(since) {
  const { isConnected } = useIntegrations();
  // `since = null` means "not needed" (use-data-source calls every provider
  // hook unconditionally) — skip rather than fetch with no date.
  const win = resolveFetchWindow(since, [canonicalMergedSinceIso()]);
  const fetchIso = win?.fetchIso ?? null;
  const filterIso = win?.filterIso ?? null;
  const swr = useSwrIf(isConnected("github") && Boolean(fetchIso), `github:merged:${fetchIso}`, () =>
    githubApi.myMergedSince(fetchIso),
  );
  const normalized = useMemo(
    () => (swr.data ? normalizeGithubMergedSearch(swr.data) : swr.data),
    [swr.data],
  );
  const data = useMemo(
    () => (normalized ? filterMergedSince(normalized, filterIso) : normalized),
    [normalized, filterIso],
  );
  return { ...swr, data };
}
