"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  GOAL_CONTEXT_CHANGE_EVENT,
  readContextFor,
  saveContextFor,
  clearContextFor,
  isContextComplete,
} from "./context-store";
import {
  DEMO_GOAL_ID_PREFIX,
  buildDemoContext,
  useDemoMode,
} from "@/features/demo-mode";

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
 *
 * Demo-mode short-circuit: when demo mode is on AND the goalId looks
 * like a demo goal AND the user has no real answers saved, return the
 * synthetic answers. Real answers always win.
 */
export function useGoalContext(goalId) {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(readContextFor(goalId)),
    () => "{}",
  );
  const demo = useDemoMode();

  const answers = useMemo(() => {
    const realAnswers = JSON.parse(snapshot);
    const realKeys = Object.keys(realAnswers).filter((k) => k !== "__updatedAt");
    if (realKeys.length > 0) return realAnswers;
    if (
      demo &&
      typeof goalId === "string" &&
      goalId.startsWith(DEMO_GOAL_ID_PREFIX)
    ) {
      const demoMap = buildDemoContext();
      return demoMap[goalId] || realAnswers;
    }
    return realAnswers;
  }, [snapshot, demo, goalId]);

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
 *
 * Demo-aware: in demo mode the predicate considers the demo answer map
 * for demo goals so pre-seeded rubric criteria don't trigger the
 * "needs setup" overlay on the CODE_RUBRIC widget.
 */
export function useIsContextComplete(spec) {
  const real = useSyncExternalStore(
    subscribe,
    () => (isContextComplete(spec) ? "1" : "0"),
    () => "1",
  );
  const demo = useDemoMode();
  if (real === "1") return true;
  if (
    demo &&
    spec?.goalId &&
    typeof spec.goalId === "string" &&
    spec.goalId.startsWith(DEMO_GOAL_ID_PREFIX)
  ) {
    return isContextCompleteWithDemo(spec);
  }
  return false;
}

/**
 * Mirror of `isContextComplete` from the store, but checking demo
 * answers when the real store has nothing for this goal. Kept here
 * (not in the store) so the demo-mode dependency stays out of the
 * pure non-React layer.
 */
function isContextCompleteWithDemo(spec) {
  if (!spec?.context?.required) return true;
  const questions = spec.context.questions || [];
  if (questions.length === 0) return true;
  const real = readContextFor(spec.goalId);
  const realKeys = Object.keys(real).filter((k) => k !== "__updatedAt");
  if (realKeys.length > 0) return isContextComplete(spec);
  const demoAnswers = buildDemoContext()[spec.goalId] || {};
  return questions.every((q) => hasAnswer(demoAnswers[q.id], q.kind));
}

function hasAnswer(value, kind) {
  if (value == null) return false;
  if (kind === "list") return Array.isArray(value) && value.length > 0;
  if (kind === "number") return typeof value === "number" && !Number.isNaN(value);
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}
