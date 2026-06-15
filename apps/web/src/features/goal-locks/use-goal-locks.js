"use client";

import { useSyncExternalStore } from "react";
import {
  getLocksServerSnapshot,
  getLocksSnapshot,
  subscribeLocks,
} from "./locks-store";

/**
 * Subscribe to the locks store. Returns the monotonic tick so callers can
 * use it as a memo dep and re-read lock state via `isLocked()` /
 * `readLocks()` when it changes.
 */
export function useGoalLocks() {
  return useSyncExternalStore(
    subscribeLocks,
    getLocksSnapshot,
    getLocksServerSnapshot,
  );
}
