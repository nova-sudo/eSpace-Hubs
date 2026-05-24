"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  GOAL_CONTEXT_CHANGE_EVENT,
  readContextFor,
  saveContextFor,
  clearContextFor,
  isContextComplete,
} from "./context-store";

function subscribe(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(GOAL_CONTEXT_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(GOAL_CONTEXT_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
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
  const snapshot = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(readContextFor(goalId)),
    () => "{}",
  );

  const answers = useMemo(() => JSON.parse(snapshot), [snapshot]);

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
  const real = useSyncExternalStore(
    subscribe,
    () => (isContextComplete(spec) ? "1" : "0"),
    () => "1",
  );
  return real === "1";
}
