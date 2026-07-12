/**
 * Public API for the goal-widgets feature.
 *
 * Importing anything from this file eagerly runs the side-effect registry
 * loader (`widgets/_register.jsx`), so every widget is bound to its
 * SPEC_KIND before the first render.
 */

// Side-effect import — must happen before registry lookups.
// Placed first so any direct import of `registerWidget` / `resolveWidget`
// from this file sees the registered set.
import "./widgets/_register.jsx";

export { GoalWidget } from "./goal-widget";
export { GoalWidgetModal } from "./goal-widget-modal";
export { GoalWidgetsGrid } from "./goal-widgets-grid";
export { WidgetShell, TargetChip } from "./widget-shell";
export { WidgetErrorBoundary } from "./widget-error-boundary";
export { registerWidget, resolveWidget, listWidgets, missingWidgetKinds } from "./registry";
export { useDataSource, windowToDays } from "./data-sources/use-data-source";
export { useGoalWidgetItems } from "./use-goal-widget-items";
export { ComplianceLine } from "./compliance-line";
export {
  goalReadiness,
  isGoalReady,
  readinessLabel,
  GOAL_READINESS,
} from "./readiness";
