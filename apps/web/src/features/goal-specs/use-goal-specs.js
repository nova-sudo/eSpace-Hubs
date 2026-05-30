"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  fetchSpecs,
  getSpecsServerSnapshot,
  getSpecsSnapshot,
  getSpecsState,
  readSpecs,
  subscribeSpecs,
} from "./specs-store";
import { useSession } from "@/features/auth";
import { validateSpec } from "@espace-devhub/shared/goal-specs";

/**
 * Subscribe to the API-direct GoalSpec store + trigger a one-shot
 * hydration on first mount per session. Same pattern as useSnapshots /
 * useStarredEvidence — idempotent fetch, shared in-flight promise.
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
  // Tick subscription — re-renders whenever the store changes.
  useSyncExternalStore(subscribeSpecs, getSpecsSnapshot, getSpecsServerSnapshot);

  const { user, loading: sessionLoading } = useSession();
  useEffect(() => {
    if (sessionLoading || !user) return;
    const s = getSpecsState();
    if (s.fetched || s.loading) return;
    void fetchSpecs();
  }, [user, sessionLoading]);

  const { specs: rawSpecs, lastAnalyzedAt } = readSpecs();

  const parsed = useMemo(() => {
    const specs = new Map();
    for (const [goalId, value] of Object.entries(rawSpecs || {})) {
      const res = validateSpec(value);
      if (res.ok) specs.set(goalId, res.spec);
    }
    return specs;
  }, [rawSpecs]);

  const isClassified = useCallback((goalId) => parsed.has(goalId), [parsed]);
  const getSpec = useCallback((goalId) => parsed.get(goalId), [parsed]);

  return {
    specs: parsed,
    rawSpecs: rawSpecs || {},
    lastAnalyzedAt: lastAnalyzedAt || 0,
    count: parsed.size,
    isClassified,
    getSpec,
  };
}
