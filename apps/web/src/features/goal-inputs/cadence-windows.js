/**
 * Cycle-anchored cadence windows. The implementation lives in
 * `@espace-devhub/shared/goal-specs` (windows.js) so the API computes the
 * exact same period grid for shared-goal analytics; this module re-exports it
 * so existing callers keep their import path.
 */

export {
  buildCycleWindows,
  cadenceConsistency,
  composedCycleBounds,
  currentPeriodKey,
  deriveCycleEndIso,
  toIsoDay,
} from "@espace-devhub/shared/goal-specs";
