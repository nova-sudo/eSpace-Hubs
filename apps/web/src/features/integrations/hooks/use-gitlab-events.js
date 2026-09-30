"use client";

import { useMemo } from "react";
import { gitlabApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import {
  canonicalEventsSinceIso,
  canonicalMergedSinceIso,
  filterEventsSince,
  resolveFetchWindow,
} from "./provider-windows";

/**
 * Fetch current user's GitLab events since a given Date (or days-ago
 * number / ISO). Callers inside the last 90 days share the canonical events
 * fetch; older windows (Evidence's YTD) share the long canonical one. Both
 * are sliced client-side. Pass `null` to skip.
 */
export function useGitlabEventsSince(since) {
  const { isConnected } = useIntegrations();
  const win = resolveFetchWindow(since, [canonicalEventsSinceIso(), canonicalMergedSinceIso()]);
  const fetchIso = win?.fetchIso ?? null;
  const filterIso = win?.filterIso ?? null;
  const swr = useSwrIf(isConnected("gitlab") && Boolean(fetchIso), `gitlab:events:${fetchIso}`, () =>
    gitlabApi.myEventsSince(fetchIso),
  );
  const data = useMemo(
    () => (Array.isArray(swr.data) ? filterEventsSince(swr.data, filterIso) : swr.data),
    [swr.data, filterIso],
  );
  return { ...swr, data };
}

export function useGitlabEvents(days = 30) {
  return useGitlabEventsSince(days);
}
