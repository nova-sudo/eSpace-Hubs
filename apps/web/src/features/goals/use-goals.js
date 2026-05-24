"use client";

import { useSyncExternalStore } from "react";
import { GOALS_CHANGE_EVENT, readGoals } from "./goals-store";

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(GOALS_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(GOALS_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot() {
  return JSON.stringify(readGoals());
}
function getServerSnapshot() {
  return JSON.stringify({ l1s: [] });
}

/**
 * Subscribe to the user's locally-stored goal tree. Returns:
 *   - `goals`   : the L1/L2 tree
 *   - `total`   : { l1s, l2s }
 *   - `weights` : { total, remaining }  (sum of L1 weightages, 100 - sum)
 */
export function useGoals() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const goals = JSON.parse(raw);

  const totalL1 = goals.l1s.length;
  const totalL2 = goals.l1s.reduce((sum, l1) => sum + l1.l2s.length, 0);
  const weightSum = goals.l1s.reduce(
    (sum, l1) => sum + (Number(l1.weightage) || 0),
    0,
  );

  return {
    goals,
    total: { l1s: totalL1, l2s: totalL2 },
    weights: { total: weightSum, remaining: Math.max(0, 100 - weightSum) },
  };
}
