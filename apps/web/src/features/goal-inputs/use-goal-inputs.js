"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  appendEntry,
  clearGoalEntries,
  fetchInputs,
  getInputsServerSnapshot,
  getInputsSnapshot,
  getInputsState,
  readGoalEntries,
  removeEntry,
  subscribeInputs,
} from "./inputs-store";
import { useSession } from "@/features/auth";

/**
 * Shared hydration primitive — subscribe to the API-direct store's
 * monotonic tick and kick off a one-shot GET on session establishment.
 * Returns the tick so callers can use it as a memo dep. Idempotent:
 * concurrent consumers share the in-flight promise inside fetchInputs().
 */
function useInputsStore() {
  const tick = useSyncExternalStore(
    subscribeInputs,
    getInputsSnapshot,
    getInputsServerSnapshot,
  );
  const { user, loading: sessionLoading } = useSession();
  useEffect(() => {
    if (sessionLoading || !user) return;
    const s = getInputsState();
    if (s.fetched || s.loading) return;
    void fetchInputs();
  }, [user, sessionLoading]);
  return tick;
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
  const tick = useInputsStore();

  const entries = useMemo(
    () => (goalId ? readGoalEntries(goalId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [goalId, tick],
  );

  const append = useCallback(
    (value, note, ts) =>
      appendEntry(
        ts != null ? { goalId, value, note, ts } : { goalId, value, note },
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

/**
 * Hydration-only hook for whole-map readers (snapshots auto-capture /
 * backfill, evidence goal-readings). Returns the store tick so a
 * subscribing component re-renders when the inputs store hydrates or
 * changes; the consumer reads the actual entries via readInputs() inside
 * its own memo, keyed on this tick. Mounting it also guarantees the
 * one-shot fetch fires even when no per-goal useGoalInputs() is mounted.
 */
export function useAllGoalInputs() {
  return useInputsStore();
}
