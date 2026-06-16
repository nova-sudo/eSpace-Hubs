/**
 * Public API for the goal-context feature.
 *
 * Consumers:
 *   - Widget resolver: uses `useIsContextComplete(spec)` to decide whether
 *     to route a goal to the ContextCollector shell instead of the widget.
 *   - ContextCollector UI: uses `useGoalContext(goalId)` for the form.
 *   - Specialist widgets (future): read `useGoalContext(goalId).answers`
 *     to feed user-defined truths into their rendering / scoring logic.
 *   - Whole-map readers (evidence goal-readings): mount `useAllGoalContext()`
 *     so they re-render and re-read once the store hydrates.
 *
 * Hydration is driven by the consuming hooks on session establishment —
 * there's no longer a standalone <ContextSync /> mount.
 */
export {
  useGoalContext,
  useIsContextComplete,
  useAllGoalContext,
} from "./use-goal-context";
export {
  readContextFor,
  saveContextFor,
  clearContextFor,
  isContextComplete,
} from "./context-store";
export {
  resolveMilestoneItems,
  collectListAnswers,
} from "./milestone-items";
