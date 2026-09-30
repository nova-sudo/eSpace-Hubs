"use client";

import { useMemo } from "react";
import { gitlabApi, normalizeGitlabMerged } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import {
  canonicalMergedSinceIso,
  filterMergedSince,
  resolveFetchWindow,
} from "./provider-windows";

/**
 * Fetch the user's merged MRs since a given Date (or days-ago number / ISO).
 * All callers share the canonical long-window fetch (see
 * `provider-windows.js`) and get a client-side slice of it.
 */
export function useGitlabMergedSince(since) {
  const { isConnected } = useIntegrations();
  const win = resolveFetchWindow(since, [canonicalMergedSinceIso()]);
  const fetchIso = win?.fetchIso ?? null;
  const filterIso = win?.filterIso ?? null;
  // `since = null` means "not needed" — skip rather than fetch with no date.
  const swr = useSwrIf(isConnected("gitlab") && Boolean(fetchIso), `gitlab:merged:${fetchIso}`, () =>
    gitlabApi.myMergedSince(fetchIso).then(normalizeGitlabMerged),
  );
  const data = useMemo(
    () => (swr.data ? filterMergedSince(swr.data, filterIso) : swr.data),
    [swr.data, filterIso],
  );
  return { ...swr, data };
}

// Convenience fixed-window hooks kept for backwards compat.
export function useGitlabMerged30d() {
  return useGitlabMergedSince(30);
}

export function useGitlabMerged90d() {
  return useGitlabMergedSince(90);
}
