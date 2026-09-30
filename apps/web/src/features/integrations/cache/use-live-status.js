"use client";

/**
 * The bridge between a provider-backed hook's result and `<LiveValue>`:
 * turns `{ isLoading, error, hasValue, … }` plus the provider-level cache /
 * rate-limit state into the `status` object the primitive renders.
 *
 *   const status = useLiveStatus({
 *     providers: ["github", "gitlab"],   // what the number is made of
 *     hasValue: count != null,           // a value to show (live or last-known)
 *     dataReady: data !== undefined,     // the underlying feed has answered
 *     isLoading, error, fetchedAt,
 *   });
 *   <LiveValue status={status} skeleton="w-[3ch]">{count}</LiveValue>
 *
 * "Pending" (→ skeleton) covers the gaps where a hook reports neither data
 * nor loading: the integrations list hasn't arrived yet, or a provider is
 * connected and its first fetch simply hasn't started. Without that, a cold
 * load flashed "No activity yet" (or a 0) for a beat before the skeleton.
 */

import { rateLimitProviderLabel } from "@/lib/rate-limit";
import { getIntegrationsState } from "../integrations-store";
import { useIntegrations } from "../use-integrations";
import { refreshIntegrationData } from "../refresh";
import { useProviderActivity } from "./use-provider-freshness";

/** Display name for a set of providers ("GitHub", "GitHub or GitLab"). */
export function providersLabel(providers) {
  const names = [...new Set((providers || []).filter(Boolean))].map(rateLimitProviderLabel);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * Pure half (exported for tests). `connected` is the subset of `providers`
 * with a token on file; `integrationsReady` is false until the list loads.
 */
export function deriveLiveStatus({
  providers = [],
  connected = providers,
  integrationsReady = true,
  hasValue = false,
  dataReady = false,
  isLoading = false,
  error = null,
  fetchedAt = null,
  activity = {},
  emptyLabel,
  notConnectedLabel,
}) {
  const relevant = connected.length > 0 ? connected : providers;
  const limitedUntil = error?.rateLimitedUntil ?? activity.rateLimitedUntil ?? null;
  const who = error?.provider ? rateLimitProviderLabel(error.provider) : providersLabel(relevant);
  const noneConnected = integrationsReady && providers.length > 0 && connected.length === 0;
  const pending =
    !integrationsReady ||
    Boolean(isLoading) ||
    (!noneConnected && !dataReady && !error);
  return {
    hasValue: Boolean(hasValue),
    pending,
    refreshing: Boolean(activity.isRefreshing),
    error: error || null,
    rateLimitedUntil: limitedUntil,
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null,
    provider: who,
    emptyLabel: noneConnected
      ? notConnectedLabel || `Connect ${providersLabel(providers)} in Settings`
      : emptyLabel,
  };
}

export function useLiveStatus({ providers = [], ...rest }) {
  const { isConnected } = useIntegrations();
  const s = getIntegrationsState();
  // A failed list load must not skeleton forever — treat it as answered.
  const integrationsReady = s.fetched || (!s.loading && Boolean(s.error));
  const connected = providers.filter((p) => isConnected(p === "gh_actions" ? "github" : p));
  const activity = useProviderActivity(connected.length > 0 ? connected : providers);
  return {
    ...deriveLiveStatus({ providers, connected, integrationsReady, activity, ...rest }),
    // <LiveValue> uses this for its Retry unless the caller passes onRetry.
    retry: retryProviders,
  };
}

function retryProviders() {
  void refreshIntegrationData();
}
