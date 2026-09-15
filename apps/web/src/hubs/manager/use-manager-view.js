"use client";

/**
 * React binding for the manager portal's view pick (see
 * manager-view-store.js). Returns `[view, setView]`.
 *
 * `useSyncExternalStore` with a server snapshot of the fallback keeps
 * the first client paint identical to the server's, so switching views
 * never trips a hydration mismatch; the stored pick lands on the first
 * post-hydration read.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  readManagerView,
  subscribeManagerView,
  writeManagerView,
} from "./manager-view-store";

export function useManagerView(key, allowed, fallback) {
  const view = useSyncExternalStore(
    subscribeManagerView,
    () => readManagerView(key, allowed, fallback),
    () => fallback,
  );
  const setView = useCallback(
    (next) => {
      if (!allowed.includes(next)) return;
      writeManagerView(key, next);
    },
    // `allowed` is a module-level constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [view, setView];
}
