/**
 * Per-goal "is this window owed" check, computed OUTSIDE React hook rules —
 * needed because "Owed only" filters the row LIST before any row component
 * mounts, so it can't rely on each row's own `useGoalInputs`/`useGoalLocks`
 * hooks. Mirrors the synchronous-read pattern `readCappedGoalTier` already
 * uses for the same reason (ranking/filtering many goals outside a
 * component tree).
 *
 * Reads the same plain-function stores every hook-based caller reads from
 * (`getGoalsState`-adjacent: `readGoalEntries`, `readLocks`) — no React,
 * no subscription of its own. The caller (the flow page) is responsible for
 * re-running this after the stores it actually subscribes to
 * (`useAllGoalInputs`, `useGoalLocks`) tick.
 */

import {
  readGoalEntries,
  buildCycleWindows,
  composedCycleBounds,
} from "@/features/goal-inputs";
import { readLocks } from "@/features/goal-locks";
import { isSingleRecordWidget, specCadence } from "@/features/goal-specs";

/** True when this goal has at least one "owed" (not logged, not settled)
 *  cadence window right now. Non-cadenced / single-record goals are never
 *  owed by this definition — they have no per-window state to owe. */
export function isGoalOwed(goalId, spec) {
  if (!goalId || !spec) return false;
  const cadence = isSingleRecordWidget(spec.widget) ? null : specCadence(spec);
  if (!cadence) return false;

  const entries = readGoalEntries(goalId);
  const prefix = `${goalId}::`;
  const allLocks = readLocks();
  const lockedKeys = new Set();
  for (const k of Object.keys(allLocks)) {
    if (allLocks[k] && k.startsWith(prefix)) lockedKeys.add(k.slice(prefix.length));
  }

  const cyc = buildCycleWindows({
    entries,
    cadence,
    now: Date.now(),
    lockedKeys,
    ...composedCycleBounds(spec),
  });
  return (cyc.windows || []).some((w) => w.state === "owed");
}
