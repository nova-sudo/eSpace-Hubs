/**
 * Per-goal cadence windows for a review packet, in the SHARED window-state
 * vocabulary (filled | settled | owed | current | future | before) — taken
 * verbatim from `buildCycleWindows`, never re-mapped.
 */

import { buildCycleWindows, composedCycleBounds, readInputs } from "@/features/goal-inputs";
import { readLocks } from "@/features/goal-locks";
import { isSingleRecordWidget, specCadence } from "@/features/goal-specs";
import { readGoalTier } from "@/features/goal-tiers";

/** @returns {{ key: string, label: string, state: string, verdict: string|null }[]} */
export function windowsForGoal(goalId, spec, now = Date.now()) {
  if (!goalId || !spec || isSingleRecordWidget(spec.widget)) return [];
  const cadence = specCadence(spec);
  if (!cadence) return [];
  const prefix = `${goalId}::`;
  const locks = readLocks();
  const lockedKeys = new Set();
  for (const k of Object.keys(locks)) {
    if (locks[k] && k.startsWith(prefix)) lockedKeys.add(k.slice(prefix.length));
  }
  const entries = readInputs()[goalId] ?? [];
  const cycle = buildCycleWindows({
    entries,
    cadence,
    now,
    lockedKeys,
    ...composedCycleBounds(spec),
  });
  if (!Array.isArray(cycle?.windows)) return [];
  return cycle.windows.map((w) => ({
    key: w.key,
    label: w.label ?? w.key,
    state: w.state,
    verdict: readGoalTier(`${goalId}::${w.key}`)?.tier ?? null,
  }));
}
