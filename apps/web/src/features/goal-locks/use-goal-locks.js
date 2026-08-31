"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  getLocksServerSnapshot,
  getLocksSnapshot,
  hydrateLocks,
  subscribeLocks,
} from "./locks-store";
import { useSession } from "@/features/auth";

/**
 * Subscribe to the locks store + trigger the one-shot server hydration
 * once a session exists (locks are API-direct now — see locks-store's
 * header). Returns the monotonic tick so callers can use it as a memo
 * dep and re-read lock state via `isLocked()` / `readLocks()` when it
 * changes.
 */
export function useGoalLocks() {
  const tick = useSyncExternalStore(
    subscribeLocks,
    getLocksSnapshot,
    getLocksServerSnapshot,
  );
  const { user, loading } = useSession();
  useEffect(() => {
    if (loading || !user) return;
    void hydrateLocks();
  }, [user, loading]);
  return tick;
}
