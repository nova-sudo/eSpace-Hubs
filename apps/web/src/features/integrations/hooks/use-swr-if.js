"use client";

import useSWR from "swr";

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
 */
export function useSwrIf(enabled, key, fetcher, options = {}) {
  return useSWR(enabled ? key : null, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 60_000,
    ...options,
  });
}
