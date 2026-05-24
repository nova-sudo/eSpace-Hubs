"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  INPUTS_CHANGE_EVENT,
  appendEntry,
  readInputs,
  removeEntry,
  clearGoalEntries,
} from "./inputs-store";

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(INPUTS_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(INPUTS_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot() {
  return JSON.stringify(readInputs());
}

function getServerSnapshot() {
  return JSON.stringify({});
}

/**
 * Hook: subscribe to a single goal's time-series entries.
 *
 * Returns:
 *   - entries                   : Array<GoalInput>  (ts-ascending)
 *   - latest                    : GoalInput | null
 *   - append(value, note?, ts?) : persist a new entry. `ts` (epoch ms)
 *                                 is optional — pass it to record an
 *                                 entry against a past week (used by
 *                                 the weekly check-in / backfill flow).
 *                                 Defaults to `Date.now()`.
 *   - remove(ts)                : delete an entry by timestamp
 *   - clear()                   : wipe every entry for this goal
 */
export function useGoalInputs(goalId) {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const entries = useMemo(() => {
    if (!goalId) return [];
    const state = JSON.parse(raw);
    const realList = state[goalId];
    if (Array.isArray(realList) && realList.length > 0) return realList;
    return [];
  }, [raw, goalId]);

  const append = useCallback(
    (value, note, ts) =>
      appendEntry(
        ts != null
          ? { goalId, value, note, ts }
          : { goalId, value, note },
      ),
    [goalId],
  );
  const remove = useCallback((ts) => removeEntry(goalId, ts), [goalId]);
  const clear = useCallback(() => clearGoalEntries(goalId), [goalId]);

  return {
    entries,
    latest: entries.length > 0 ? entries[entries.length - 1] : null,
    append,
    remove,
    clear,
  };
}
