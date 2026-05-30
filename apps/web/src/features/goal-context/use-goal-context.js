"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  fetchContext,
  getContextServerSnapshot,
  getContextSnapshot,
  getContextState,
  readContextFor,
  saveContextFor,
  clearContextFor,
  isContextComplete,
  subscribeContext,
} from "./context-store";
import { useSession } from "@/features/auth";

/**
 * Shared hydration primitive — subscribe to the API-direct store's
 * monotonic tick and kick off a one-shot GET on session establishment.
 * Returns the tick so callers can use it as a memo dep. Same idempotent
 * pattern as useGoalSpecs / useStarredEvidence — concurrent consumers
 * share the in-flight promise inside fetchContext().
 */
function useContextStore() {
  const tick = useSyncExternalStore(
    subscribeContext,
    getContextSnapshot,
    getContextServerSnapshot,
  );
  const { user, loading: sessionLoading } = useSession();
  useEffect(() => {
    if (sessionLoading || !user) return;
    const s = getContextState();
    if (s.fetched || s.loading) return;
    void fetchContext();
  }, [user, sessionLoading]);
  return tick;
}

/**
 * React binding for the goal-context store. Scoped to a single goalId;
 * widgets that need multiple goals can call it multiple times.
 *
 * Returns:
 *   - answers: { [questionId]: string|string[]|number, __updatedAt? }
 *   - setAnswer(questionId, value): merges one key
 *   - setAnswers(partial): merges many
 *   - clear(): removes the whole entry
 */
export function useGoalContext(goalId) {
  const tick = useContextStore();

  // readContextFor returns a fresh object each call; re-derive only when
  // the store ticks or the goalId changes so downstream memos stay put
  // between unrelated renders.
  const answers = useMemo(
    () => readContextFor(goalId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [goalId, tick],
  );

  const setAnswer = useCallback(
    (questionId, value) => saveContextFor(goalId, { [questionId]: value }),
    [goalId],
  );
  const setAnswers = useCallback(
    (partial) => saveContextFor(goalId, partial),
    [goalId],
  );
  const clear = useCallback(() => clearContextFor(goalId), [goalId]);

  return { answers, setAnswer, setAnswers, clear };
}

/**
 * Read-only predicate hook — "should we hide the widget behind a
 * ContextCollector?". Re-fires whenever the store changes so the widget
 * auto-reveals when the user fills in the last answer.
 */
export function useIsContextComplete(spec) {
  const tick = useContextStore();
  return useMemo(
    () => isContextComplete(spec),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, tick],
  );
}

/**
 * Hydration-only hook for whole-map readers (evidence goal-readings).
 * Returns the store tick so a subscribing component re-renders when the
 * context store hydrates or changes; the consumer reads the actual
 * answer maps via readContextFor() inside its own memo, keyed on this
 * tick. Mounting it also guarantees the one-shot fetch fires even when
 * no per-goal useGoalContext() is mounted.
 */
export function useAllGoalContext() {
  return useContextStore();
}
