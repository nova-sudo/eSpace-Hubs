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
  REJECTED: "changes-requested", // manager sent it back — dev must revise
  DELEGATED: "delegated", // judged by someone else — no self-tracking
  NEEDS_CONTEXT: "needs-context", // context questions not answered yet
  READY: "ready", // fully defined — safe to enter data
});

export function goalReadiness(spec, contextComplete) {
  if (!spec) return GOAL_READINESS.UNCLASSIFIED;
  if (spec.untrackable) return GOAL_READINESS.UNTRACKABLE;
  // A "Build Your Own" tracker in the approval flow is read-only until
  // approved. Pending and rejected are DIFFERENT states with different
  // owners: pending waits on the MANAGER, rejected waits on the DEV —
  // collapsing them told a rejected user they were "still waiting on
  // approval" while the manager was waiting on them.
  if (spec.approval?.status === "rejected") return GOAL_READINESS.REJECTED;
  if (spec.approval?.status === "pending") {
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

/** Two-or-three-word badge text for a not-ready goal. The sentence that
 *  explains it (`readinessLabel`) belongs next to the control, not in the
 *  badge. */
export function readinessShortLabel(status) {
  switch (status) {
    case GOAL_READINESS.PENDING_APPROVAL:
      return "Awaiting approval";
    case GOAL_READINESS.REJECTED:
      return "Changes requested";
    case GOAL_READINESS.NEEDS_CONTEXT:
      return "Needs setup";
    case GOAL_READINESS.DELEGATED:
      return "Delegated";
    case GOAL_READINESS.UNTRACKABLE:
      return "Untrackable";
    case GOAL_READINESS.UNCLASSIFIED:
      return "No tracker yet";
    default:
      return "";
  }
}

/**
 * The sentence for a not-ready goal, written for the Goals page where the
 * tracker sits DIRECTLY BELOW — so it points down, never "in Goals".
 */
export function readinessHint(status) {
  switch (status) {
    case GOAL_READINESS.PENDING_APPROVAL:
      return "Waiting on your manager's approval before you can log — the tracker below is read-only until then.";
    case GOAL_READINESS.REJECTED:
      return "Your manager asked for changes — use “Revise & resubmit” on the tracker below.";
    case GOAL_READINESS.NEEDS_CONTEXT:
      return "Answer the setup questions on the tracker below to start logging.";
    case GOAL_READINESS.DELEGATED:
      return "Judged by someone else — nothing to log here. Use “Self-track” below to take it back.";
    case GOAL_READINESS.UNTRACKABLE:
      return "Marked untrackable — use “Track it” below to unflag it.";
    case GOAL_READINESS.UNCLASSIFIED:
      return "Not classified yet — classify it below.";
    default:
      return "";
  }
}

/**
 * Short reason for a not-ready goal (for the "finish setup" row).
 *
 * `opts.audience: "manager"` words it for the person who CAN'T fix it —
 * the report's manager reading their board — naming who can:
 * "Dana hasn't set up a tracker for this yet." The default is the dev's own
 * copy, which tells them what to do.
 */
export function readinessLabel(status, opts = {}) {
  if (opts.audience === "manager") return managerReadinessLabel(status, opts.name);
  switch (status) {
    case GOAL_READINESS.PENDING_APPROVAL:
      return "Waiting on your manager's approval before it goes live.";
    case GOAL_READINESS.REJECTED:
      return "Your manager requested changes — open the goal to revise & resubmit.";
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

function managerReadinessLabel(status, name) {
  const who = (name || "They").split(" ")[0];
  switch (status) {
    case GOAL_READINESS.PENDING_APPROVAL:
      return "Waiting on your approval before it goes live.";
    case GOAL_READINESS.REJECTED:
      return `You asked for changes — ${who} is revising it.`;
    case GOAL_READINESS.NEEDS_CONTEXT:
      return `${who} hasn't answered this tracker's setup questions yet.`;
    case GOAL_READINESS.DELEGATED:
      return "Judged by a reviewer, not self-tracked.";
    case GOAL_READINESS.UNTRACKABLE:
      return `${who} marked this untrackable for now.`;
    case GOAL_READINESS.UNCLASSIFIED:
      return `${who} hasn't set up a tracker for this yet.`;
    default:
      return "";
  }
}
