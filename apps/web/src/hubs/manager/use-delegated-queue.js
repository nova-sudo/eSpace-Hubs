"use client";

/**
 * Manager Hub — delegated-goal queue. Reads GET /manager/delegated-queue
 * (goals across all your reports marked "manager evaluates", each with
 * the current verdict if any). Returns { loading, items, error, refresh };
 * refresh() refetches in place after grading.
 */

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";

export function useDelegatedQueue() {
  const [token, setToken] = useState(0);
  const [state, setState] = useState({ loading: true, items: [], error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ loading: s.items.length === 0, items: s.items, error: null }));
    (async () => {
      const r = await apiGet("/manager/delegated-queue");
      if (cancelled) return;
      if (r.ok) {
        setState({ loading: false, items: r.data?.items ?? [], error: null });
      } else {
        setState((s) => ({ loading: false, items: s.items, error: r.error ?? "error" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const refresh = useCallback(() => setToken((t) => t + 1), []);
  return { ...state, refresh };
}
