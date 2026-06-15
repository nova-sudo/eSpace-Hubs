/**
 * goal-locks — shared domain. Per-goal-per-window "this period is finalised"
 * flags that let the user settle a goal window (done, or nothing to report)
 * so the status model stops treating it as owed.
 */

export {
  isLocked,
  readLocks,
  setLock,
  toggleLock,
  LOCKS_STORAGE_KEY,
  LOCKS_CHANGE_EVENT,
} from "./locks-store";
export { useGoalLocks } from "./use-goal-locks";
export { currentWindowKey } from "./window-key";
