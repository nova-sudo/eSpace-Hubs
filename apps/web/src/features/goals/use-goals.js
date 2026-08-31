"use client";

/**
 * React hook over the API-backed goals store.
 *
 * Behavior:
 *   - First mount triggers `fetchGoals()` (idempotent — multiple
 *     concurrent useGoals consumers share one in-flight request).
 *   - Subsequent renders re-read in-memory state via
 *     useSyncExternalStore + the "goals:change" event.
 *   - On auth transitions, the auth wipe handler resets the store, so
 *     the next render from any subscribed component fires a fresh
 *     fetch for the new user.
 *
 * Returned shape mirrors the pre-refactor hook so call sites that
 * destructured `{ goals, total, weights }` keep working. Added
 * `loading` / `error` so editor components can show a spinner or a
 * "couldn't save" banner.
 */

import { useEffect, useSyncExternalStore } from "react";
import {
  fetchGoals,
  getGoalsState,
  subscribeGoals,
  GOALS_SCHEMA_VERSION,
} from "./goals-store";

const SERVER_SNAPSHOT_KEY = JSON.stringify({
  loading: false,
  fetched: false,
  attempted: false,
  error: null,
  l1s: [],
});

function getSnapshot() {
  // useSyncExternalStore requires snapshot stability across renders
  // when nothing has changed. Stringifying is the simplest equality
  // shim: same state → same string → React.memo / dep arrays settle.
  return JSON.stringify(getGoalsState());
}
function getServerSnapshot() {
  return SERVER_SNAPSHOT_KEY;
}

export function useGoals() {
  const raw = useSyncExternalStore(
    subscribeGoals,
    getSnapshot,
    getServerSnapshot,
  );
  const stateSnapshot = JSON.parse(raw);

  // Kick off the initial fetch the first time any consumer mounts
  // after an auth transition or app boot. fetchGoals is idempotent —
  // concurrent calls share the same in-flight promise. Gated on
  // `attempted`, NOT `fetched`: a failed fetch settles with
  // `fetched:false`, and gating on that refired this effect forever —
  // an infinite spinner that hammered the API. Failures now settle
  // once; recovery is the user-facing retry (or the next auth
  // transition, which resets the store).
  useEffect(() => {
    if (!stateSnapshot.attempted && !stateSnapshot.loading) {
      void fetchGoals();
    }
  }, [stateSnapshot.attempted, stateSnapshot.loading]);

  const goals = {
    schemaVersion: GOALS_SCHEMA_VERSION,
    l1s: stateSnapshot.l1s,
  };

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
    loading: stateSnapshot.loading,
    // `fetched` flips true once the first load settles (even on an empty
    // server). Consumers gate their empty state on this so it never
    // flashes before hydration: `!fetched → loader`.
    fetched: stateSnapshot.fetched,
    error: stateSnapshot.error,
    // Explicit user-driven retry after a failed load. fetchGoals ignores
    // the `attempted` gate — that gate only stops the AUTOMATIC refetch
    // loop, never a person clicking "Retry".
    retry: fetchGoals,
  };
}
