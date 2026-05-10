"use client";

import { useMemo, useSyncExternalStore } from "react";
import { GOALS_CHANGE_EVENT, readGoals } from "./goals-store";
import { buildDemoGoals, useDemoMode } from "@/features/demo-mode";

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
 *
 * Demo-mode override: when demo is on, ALWAYS return the synthetic
 * tree — even if the user has real goals saved. Real goals stay in
 * localStorage untouched (this hook never writes), so flipping demo
 * off restores them immediately. The override is necessary because
 * snapshot readings / compliance / compare-weeks key off demo goal
 * ids; without it, real goals + demo readings would render as zeros
 * across the board.
 */
export function useGoals() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const real = JSON.parse(raw);
  const demo = useDemoMode();
  const demoGoals = useMemo(
    () => (demo ? buildDemoGoals() : null),
    [demo],
  );

  const goals = demo ? demoGoals : real;

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
