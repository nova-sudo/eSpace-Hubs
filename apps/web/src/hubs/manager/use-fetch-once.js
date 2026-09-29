"use client";

/**
 * The manager hub's one GET pattern, on SWR (CLAUDE.md: SWR for all remote
 * data): `useFetchOnce(path)` → { loading, data, error, refresh }. `path`
 * IS the SWR key, so:
 *   - two surfaces reading the same endpoint share one request (grading
 *     progress on Overview + Team, a report's packets on the board header
 *     + rail card),
 *   - switching path (2026 → 2025) never shows the old path's data under
 *     the new label — the cache is keyed by URL,
 *   - a write can refresh every reader with `revalidateManagerData()`.
 * null skips the fetch. `error` is the API's `{code, message}`.
 */

import { useCallback } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { apiGet } from "@/lib/api-client";

/** SWR fetcher over apiGet — throws the API's `{code, message}` error. */
export async function managerFetcher(path) {
  const r = await apiGet(path);
  if (!r.ok) throw r.error ?? { code: "error", message: "Request failed." };
  return r.data ?? null;
}

/** A stable empty list for `data?.x ?? EMPTY_LIST` — no new [] per render. */
export const EMPTY_LIST = Object.freeze([]);

export const MANAGER_SWR_OPTIONS = Object.freeze({
  revalidateOnFocus: false,
  shouldRetryOnError: false,
  dedupingInterval: 5_000,
});

export function useFetchOnce(path) {
  const { data, error, isLoading, mutate } = useSWR(
    path || null,
    managerFetcher,
    MANAGER_SWR_OPTIONS,
  );
  const refresh = useCallback(() => {
    void mutate();
  }, [mutate]);
  return {
    loading: Boolean(path) && isLoading,
    data: data ?? null,
    error: error ?? null,
    refresh,
  };
}

/**
 * Revalidate the manager surfaces a grade or an approval decision changes:
 * grading progress / calibration counts, the delegated + approvals queues,
 * team summary and trends, and (when given) that report's own reads.
 */
export function revalidateManagerData(userId) {
  const reportPrefix = userId ? `/manager/reports/${encodeURIComponent(userId)}` : null;
  return globalMutate(
    (key) =>
      typeof key === "string" &&
      (key.startsWith("/manager/grading-progress") ||
        key.startsWith("/manager/delegated-queue") ||
        key.startsWith("/manager/approvals") ||
        key.startsWith("/manager/team-") ||
        (reportPrefix !== null && key.startsWith(reportPrefix))),
  );
}
