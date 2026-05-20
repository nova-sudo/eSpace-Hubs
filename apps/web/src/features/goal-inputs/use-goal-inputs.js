"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  INPUTS_CHANGE_EVENT,
  appendEntry,
  readInputs,
  removeEntry,
  clearGoalEntries,
} from "./inputs-store";
import {
  DEMO_GOAL_ID_PREFIX,
  buildDemoInputs,
  useDemoMode,
} from "@/features/demo-mode";

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
 *
 * Demo-mode short-circuit: when demo mode is on AND the goalId looks
 * like a demo goal AND the user has no real entries on it, we return
 * the synthetic entry list. As soon as the user appends a real entry,
 * we switch to their data — flipping demo never overwrites their work.
 */
export function useGoalInputs(goalId) {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const demo = useDemoMode();

  // Pre-decorate demo entries with the goalId so they match the store's
  // `{ goalId, ts, value, note? }` shape exactly. Built once per toggle.
  const demoEntriesByGoal = useMemo(() => {
    if (!demo) return null;
    const raw = buildDemoInputs();
    const out = {};
    for (const [gid, list] of Object.entries(raw)) {
      out[gid] = list.map((e) => ({ ...e, goalId: gid }));
    }
    return out;
  }, [demo]);

  const entries = useMemo(() => {
    if (!goalId) return [];
    const state = JSON.parse(raw);
    const realList = state[goalId];
    if (Array.isArray(realList) && realList.length > 0) return realList;
    if (
      demo &&
      demoEntriesByGoal &&
      typeof goalId === "string" &&
      goalId.startsWith(DEMO_GOAL_ID_PREFIX)
    ) {
      return demoEntriesByGoal[goalId] || [];
    }
    return [];
  }, [raw, goalId, demo, demoEntriesByGoal]);

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
