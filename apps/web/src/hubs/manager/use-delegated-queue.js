"use client";

/**
 * Manager Hub — delegated-goal queue. Reads GET /manager/delegated-queue
 * (goals across all your reports marked "manager evaluates", each with
 * the current verdict if any). Returns { loading, items, error, refresh };
 * refresh() refetches in place after grading.
 */

import { EMPTY_LIST, useFetchOnce } from "./use-fetch-once";

export function useDelegatedQueue() {
  const { loading, data, error, refresh } = useFetchOnce("/manager/delegated-queue");
  return {
    loading,
    items: Array.isArray(data?.items) ? data.items : EMPTY_LIST,
    error,
    refresh,
  };
}
