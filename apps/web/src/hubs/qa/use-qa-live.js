"use client";

import { useLiveStatus } from "@/features/integrations";

/**
 * `<LiveValue>` / `<FreshnessNote>` status for a QA tile's one provider
 * feed (a `useSwrIf` result): the tile keeps its cached number through a
 * failed or rate-limited refresh and says how old it is.
 */
export function useQaLive(provider, swr) {
  return useLiveStatus({
    providers: [provider],
    hasValue: swr?.data !== undefined,
    dataReady: swr?.data !== undefined,
    isLoading: swr?.isLoading,
    error: swr?.error || null,
    fetchedAt: swr?.fetchedAt ?? null,
  });
}
