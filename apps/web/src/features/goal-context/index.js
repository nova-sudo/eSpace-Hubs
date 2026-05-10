/**
 * Public API for the goal-context feature.
 *
 * Consumers:
 *   - Widget resolver: uses `useIsContextComplete(spec)` to decide whether
 *     to route a goal to the ContextCollector shell instead of the widget.
 *   - ContextCollector UI: uses `useGoalContext(goalId)` for the form.
 *   - Specialist widgets (future): read `useGoalContext(goalId).answers`
 *     to feed user-defined truths into their rendering / scoring logic.
 */
export { useGoalContext, useIsContextComplete } from "./use-goal-context";
export {
  readContextFor,
  saveContextFor,
  clearContextFor,
  isContextComplete,
} from "./context-store";
