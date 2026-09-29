"use client";

/**
 * Manager Hub — Build-Your-Own approvals queue. Reads
 * GET /manager/approvals (COMPOSED trackers across your reports pending
 * your approval). Returns { loading, items, error, refresh }.
 */

import { EMPTY_LIST, useFetchOnce } from "./use-fetch-once";

export function useApprovalsQueue() {
  const { loading, data, error, refresh } = useFetchOnce("/manager/approvals");
  return {
    loading,
    items: Array.isArray(data?.items) ? data.items : EMPTY_LIST,
    error,
    refresh,
  };
}
