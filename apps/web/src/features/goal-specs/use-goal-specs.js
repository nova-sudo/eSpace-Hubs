"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { SPECS_CHANGE_EVENT, readSpecs } from "./specs-store";
import { validateSpec } from "@espace-devhub/shared/goal-specs";

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(SPECS_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(SPECS_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot() {
  // useSyncExternalStore compares with Object.is — we MUST return a stable
  // string (or stable object reference) or every render will thrash.
  // JSON is the simplest stable key for a small localStorage-backed map.
  return JSON.stringify(readSpecs());
}

function getServerSnapshot() {
  return JSON.stringify({ specs: {}, lastAnalyzedAt: 0 });
}

/**
 * Subscribe to the persisted GoalSpec collection.
 *
 * Returns:
 *   - `specs`           : Map<goalId, validatedSpec>  (invalid ones filtered)
 *   - `rawSpecs`        : plain object with raw entries (incl. invalid) so
 *                         consumers can surface "this spec is broken" chips
 *   - `lastAnalyzedAt`  : epoch ms of the last full-tree analysis
 *   - `isClassified(id)`: boolean
 *   - `getSpec(id)`     : validated spec or undefined
 *   - `count`           : number of valid specs
 */
export function useGoalSpecs() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const parsed = useMemo(() => {
    const state = JSON.parse(raw);
    const specs = new Map();
    for (const [goalId, value] of Object.entries(state.specs || {})) {
      const res = validateSpec(value);
      if (res.ok) specs.set(goalId, res.spec);
    }
    return {
      specs,
      rawSpecs: state.specs || {},
      lastAnalyzedAt: state.lastAnalyzedAt || 0,
    };
  }, [raw]);

  const isClassified = useCallback(
    (goalId) => parsed.specs.has(goalId),
    [parsed.specs],
  );
  const getSpec = useCallback(
    (goalId) => parsed.specs.get(goalId),
    [parsed.specs],
  );

  return {
    specs: parsed.specs,
    rawSpecs: parsed.rawSpecs,
    lastAnalyzedAt: parsed.lastAnalyzedAt,
    count: parsed.specs.size,
    isClassified,
    getSpec,
  };
}
