"use client";

import useSWR from "swr";

/**
 * When each SWR key last resolved successfully. Module-level on purpose:
 * SWR dedupes concurrent fetches across hook instances sharing a key, so
 * only ONE instance's fetcher actually runs — a per-instance ref would
 * leave every other consumer of the same key with no timestamp. Feeds the
 * data-honesty provenance chip ("fetched Xm ago"); never trimmed, the key
 * space is small (a handful of provider:resource strings per session).
 */
const fetchTimes = new Map();

/** Last successful fetch time (epoch ms) for an SWR key, or null. */
export function readFetchedAt(key) {
  return key ? (fetchTimes.get(key) ?? null) : null;
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
      ...options,
    },
  );
  // Reading the map at render time is safe: SWR re-renders every consumer
  // when the shared fetch resolves, which is also when the stamp lands.
  return { ...swr, fetchedAt: enabled ? readFetchedAt(key) : null };
}
