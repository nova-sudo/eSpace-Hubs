"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  fetchSpecs,
  getSpecsServerSnapshot,
  getSpecsSnapshot,
  getSpecsState,
  readSpecs,
  readTrackingMeta,
  subscribeSpecs,
  withTrackingMeta,
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
  // Tracking start (createdAt / hireDate) is stamped onto each validated
  // spec — see specs-store's header.
  const trackingMeta = readTrackingMeta();

  // Valid specs, plus the ids whose stored spec FAILED validation. A goal
  // whose spec is broken used to look exactly like an unclassified one; the
  // page can now say "tracker data is invalid — re-analyze" instead.
  const { parsed, invalidSpecIds } = useMemo(() => {
    const specs = new Map();
    const invalid = new Set();
    for (const [goalId, value] of Object.entries(rawSpecs || {})) {
      const res = validateSpec(value);
      if (res.ok) specs.set(goalId, withTrackingMeta(goalId, res.spec));
      else invalid.add(goalId);
    }
    return { parsed: specs, invalidSpecIds: invalid };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSpecs, trackingMeta.createdAt, trackingMeta.hireDate]);

  const isClassified = useCallback((goalId) => parsed.has(goalId), [parsed]);
  const getSpec = useCallback((goalId) => parsed.get(goalId), [parsed]);

  // Hydration flags for empty-state gating (`!fetched → loader`). Read
  // fresh each render; the useSyncExternalStore subscription re-runs the
  // component when the store settles.
  const specsState = getSpecsState();

  return {
    specs: parsed,
    rawSpecs: rawSpecs || {},
    lastAnalyzedAt: lastAnalyzedAt || 0,
    count: parsed.size,
    isClassified,
    getSpec,
    fetched: specsState.fetched,
    loading: specsState.loading,
    // A failed hydration settles with `fetched:false` and this set — pages
    // must branch on it (error card + Retry) instead of loading forever.
    error: specsState.error,
    retry: fetchSpecs,
    invalidSpecIds,
  };
}
