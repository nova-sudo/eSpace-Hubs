"use client";

import useSWR from "swr";
import { providerCache } from "@/lib/provider-cache";

/**
 * When each SWR key last resolved successfully. Module-level on purpose:
 * SWR dedupes concurrent fetches across hook instances sharing a key, so
 * only ONE instance's fetcher actually runs — a per-instance ref would
 * leave every other consumer of the same key with no timestamp. Feeds the
 * data-honesty provenance chip ("fetched Xm ago"); never trimmed, the key
 * space is small (a handful of provider:resource strings per session).
 */
const fetchTimes = new Map();

/**
 * Last successful fetch time (epoch ms) for an SWR key, or null. Provider
 * keys read the persisted per-user ledger first, so "fetched 5m ago"
 * survives a reload (the value on screen came from the persisted cache).
 */
export function readFetchedAt(key) {
  if (!key) return null;
  const persisted = providerCache.freshness(key)?.fetchedAt ?? null;
  const local = fetchTimes.get(key) ?? null;
  if (persisted === null) return local;
  if (local === null) return persisted;
  return Math.max(persisted, local);
}

/**
 * SWR with a conditional key — pass `key=null` to skip the request.
 *
 * Defaults:
 * - `revalidateOnFocus: false` — tiles don't need live refresh on tab focus
 * - `shouldRetryOnError: false` — if a provider is unreachable (VPN off,
 *   token expired, network down) we'd otherwise flood the proxy with retries
 *   forever. Fail loud and let the user fix the underlying issue.
 * - `dedupingInterval: 60_000` — within a dashboard render, every tile using
 *   the same SWR key shares a single in-flight fetch.
 * - `keepPreviousData: true` — a key change (new window, new repo filter)
 *   keeps the last value on screen instead of flashing "—".
 *
 * The app-level `<ProviderCacheConfig>` seeds provider keys from the
 * per-user persisted cache (SWR `fallback`), so a cold load renders the
 * last-known value and revalidates in the background. `isLoading` is
 * therefore only true when there is NOTHING to show; use
 * `isValidating` (or `useProviderFreshness`) for "refreshing".
 *
 * Returns the SWR result plus `fetchedAt` (epoch ms of the last successful
 * fetch for this key, null before the first one resolves).
 */
export function useSwrIf(enabled, key, fetcher, options = {}) {
  const swr = useSWR(
    enabled ? key : null,
    async (...args) => {
      const result = await fetcher(...args);
      fetchTimes.set(key, Date.now());
      return result;
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      dedupingInterval: 60_000,
      keepPreviousData: true,
      ...options,
    },
  );
  // Reading the map at render time is safe: SWR re-renders every consumer
  // when the shared fetch resolves, which is also when the stamp lands.
  // Destructuring reads the getters, which is what subscribes this hook
  // to those fields — so read exactly the fields we return.
  const { data, error, isValidating, isLoading, mutate } = swr;
  return {
    data,
    error,
    isValidating,
    isLoading: Boolean(isLoading) && data === undefined,
    mutate,
    fetchedAt: enabled ? readFetchedAt(key) : null,
  };
}
