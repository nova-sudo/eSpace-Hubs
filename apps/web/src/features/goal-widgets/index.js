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
export { ComposeWidgetModal } from "./compose-widget-modal";
// The plan editor — the bigger view of a COMPOSED tracker's cycle and its
// per-window content. The compose modal mounts it to review what the AI
// generated; the widget's "Edit plan" action mounts it on a live tracker.
export { PlanEditor } from "./plan-editor/plan-editor";
export { EditPlanModal } from "./plan-editor/edit-plan-modal";
export { resolvePlanBounds, describeCycle, stampBounds } from "./plan-editor/plan-model";
export { GoalWidgetsGrid } from "./goal-widgets-grid";
export { WidgetShell, TargetChip } from "./widget-shell";
export { WidgetErrorBoundary } from "./widget-error-boundary";
export { registerWidget, resolveWidget, listWidgets, missingWidgetKinds } from "./registry";
export { useDataSource } from "./data-sources/use-data-source";
export { useGoalWidgetItems } from "./use-goal-widget-items";
export { ComplianceLine } from "./compliance-line";
// The narrative half of a period (focus / activities / deliverables) and the
// notes affordance. Exported because the compose preview and the manager's
// approval view show the same content the widget does — a manager judging
// whether the AI read the document faithfully needs to see what it kept.
export { PeriodDetail, NotesAffordance } from "./period-detail";
// Evidence FILES for a period — the deliverable itself when it has no URL.
export { EvidenceAttachments } from "./evidence-attachments";
export { ManagementRoster } from "./management-roster";
export {
  EVIDENCE_ACCEPT,
  EVIDENCE_MAX_BYTES,
  deleteEvidenceFile,
  evidenceFileUrl,
  listEvidenceFiles,
  uploadEvidenceFile,
} from "./evidence-files";
export {
  goalReadiness,
  isGoalReady,
  readinessLabel,
  GOAL_READINESS,
} from "./readiness";
