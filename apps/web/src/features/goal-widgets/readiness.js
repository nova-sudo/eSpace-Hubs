/**
 * Is a classified goal READY to be tracked, or does it still need setup?
 *
 * This is the single readiness gate every surface must obey. The Goals/hub
 * widget (`goal-widget.jsx`) walks the same states; check-in + the hub's
 * inline fill import THIS so a goal can't be data-entered on one surface
 * while it's still "finish setup" on another (the bug: check-in showed a
 * fillable milestone for a goal whose context questions weren't answered).
 *
 * Pure — pass in `contextComplete` (from `useIsContextComplete(spec)` or the
 * store's `isContextComplete(spec)`); no React/IO here.
 */

export const GOAL_READINESS = Object.freeze({
  UNCLASSIFIED: "unclassified", // no spec yet — can't track
  UNTRACKABLE: "untrackable", // AI/user flagged not currently trackable
  PENDING_APPROVAL: "pending-approval", // BYO tracker awaiting manager approval
  DELEGATED: "delegated", // judged by someone else — no self-tracking
  NEEDS_CONTEXT: "needs-context", // context questions not answered yet
  READY: "ready", // fully defined — safe to enter data
});

export function goalReadiness(spec, contextComplete) {
  if (!spec) return GOAL_READINESS.UNCLASSIFIED;
  if (spec.untrackable) return GOAL_READINESS.UNTRACKABLE;
  // A "Build Your Own" tracker awaiting (or sent back by) manager approval is
  // read-only until approved — it can't be filled or graded yet (P4).
  if (spec.approval?.status === "pending" || spec.approval?.status === "rejected") {
    return GOAL_READINESS.PENDING_APPROVAL;
  }
  if (spec.delegated?.delegated) return GOAL_READINESS.DELEGATED;
  if (spec.context?.required && !contextComplete) {
    return GOAL_READINESS.NEEDS_CONTEXT;
  }
  return GOAL_READINESS.READY;
}

export function isGoalReady(spec, contextComplete) {
  return goalReadiness(spec, contextComplete) === GOAL_READINESS.READY;
}

/** Short, user-facing reason for a not-ready goal (for the "finish setup" row). */
export function readinessLabel(status) {
  switch (status) {
    case GOAL_READINESS.PENDING_APPROVAL:
      return "Waiting on your manager's approval before it goes live.";
    case GOAL_READINESS.NEEDS_CONTEXT:
      return "Answer its setup questions in Goals to start tracking.";
    case GOAL_READINESS.DELEGATED:
      return "Judged by someone else — not self-tracked.";
    case GOAL_READINESS.UNTRACKABLE:
      return "Marked untrackable — no widget to fill yet.";
    case GOAL_READINESS.UNCLASSIFIED:
      return "Not classified yet — run the analyst in Goals.";
    default:
      return "";
  }
}
