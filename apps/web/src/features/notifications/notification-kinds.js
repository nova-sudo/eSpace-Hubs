/**
 * Notification kinds — where each one leads and what a person calls it.
 * Pure data + two helpers, shared by the bell, the inbox page and the
 * Settings → Notifications tab so the three never disagree.
 *
 * Paths are unprefixed; callers run them through useHubLink. A hub that
 * doesn't expose the slot bounces to its dashboard via the slot guard.
 */

/** The Goals page, opened on the notification's goal when it names one. */
function goalPath(n) {
  const id = n?.data?.goalId;
  return typeof id === "string" && id ? `/goals?goal=${encodeURIComponent(id)}` : "/goals";
}

function sharedGoalPath(n) {
  const id = n?.data?.assignedGoalId;
  return typeof id === "string" && id ? `/shared-goals/${encodeURIComponent(id)}` : "/shared-goals";
}

/** A report's board on the manager hub, when the row names the report. */
function reportPath(n) {
  const id = n?.data?.subjectUserId;
  return typeof id === "string" && id ? `/employees/${encodeURIComponent(id)}` : "/employees";
}

/**
 * kind → path (string or fn(n)). Rows used to only mark-as-read — an
 * inbox with no follow-through — so every kind leads somewhere.
 */
const KIND_PATH = {
  // Per-goal kinds open THAT goal (`/goals?goal=<id>`).
  manager_graded: goalPath,
  goal_approved: goalPath,
  goal_changes_requested: goalPath,
  // Managers approve on their Approvals page; admins (no-manager queue)
  // on the admin hub's — same slot id, so one path serves both.
  goal_submitted: "/approvals",
  user_pending_approval: "/users",
  review_packet_submitted: "/employees",
  // F4 scheduler kinds.
  goal_due_soon: goalPath,
  goal_overdue: goalPath,
  goal_stale: goalPath,
  approval_waiting: "/approvals",
  approval_queue_stale: "/approvals",
  // F6 — criteria changed under one of the recipient's goals.
  tier_policy_updated: goalPath,
  // Shared goals.
  assigned_goal_assigned: goalPath,
  assigned_goal_updated: goalPath,
  assigned_goal_due_soon: goalPath,
  assigned_goal_overdue: goalPath,
  assigned_goal_shared: sharedGoalPath,
  assigned_goal_period_report: sharedGoalPath,
  // Reporting line changed — the recipient's own settings has nothing to
  // do; the manager side lands on their roster.
  manager_changed: (n) => (n?.data?.subjectUserId ? reportPath(n) : null),
  // A report disputed a grade — open that report's board.
  verdict_disputed: reportPath,
};

/** The unprefixed path a notification opens, or null. */
export function notificationPath(n) {
  const entry = KIND_PATH[n?.kind];
  if (typeof entry === "function") return entry(n) ?? null;
  return entry ?? null;
}

/**
 * The kinds a person can mute, grouped for Settings → Notifications.
 * Labels are what the row is ABOUT, in sentence case.
 */
export const NOTIFICATION_KIND_GROUPS = [
  {
    title: "Your goals",
    kinds: [
      { kind: "manager_graded", label: "A manager graded one of your goals" },
      { kind: "goal_approved", label: "A tracker you submitted was approved" },
      { kind: "goal_changes_requested", label: "Changes were requested on a tracker" },
      { kind: "tier_policy_updated", label: "Grading criteria changed on one of your goals" },
      { kind: "manager_changed", label: "Your reporting line changed" },
    ],
  },
  {
    title: "Reminders",
    kinds: [
      { kind: "goal_due_soon", label: "A goal is due within a week" },
      { kind: "goal_overdue", label: "A goal is overdue" },
      { kind: "goal_stale", label: "A tracker hasn't been updated in a while" },
    ],
  },
  {
    title: "Shared goals",
    kinds: [
      { kind: "assigned_goal_assigned", label: "A goal was shared with you to fill" },
      { kind: "assigned_goal_updated", label: "A shared goal you fill changed" },
      { kind: "assigned_goal_due_soon", label: "A shared goal's period is due soon" },
      { kind: "assigned_goal_overdue", label: "A shared goal's period is overdue" },
      { kind: "assigned_goal_shared", label: "A shared goal's analytics were shared with you" },
      { kind: "assigned_goal_period_report", label: "A shared goal's period report is ready" },
    ],
  },
  {
    title: "Reviewing others",
    kinds: [
      { kind: "goal_submitted", label: "A tracker needs your approval" },
      { kind: "approval_waiting", label: "An approval has waited over a day" },
      { kind: "approval_queue_stale", label: "Your approvals queue has items over 3 days old" },
      { kind: "review_packet_submitted", label: "A report submitted a review packet" },
      { kind: "verdict_disputed", label: "A report disagreed with a grade" },
      { kind: "user_pending_approval", label: "Someone is waiting to join the org" },
    ],
  },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Rows written before the scheduler learned to format dates carry raw ISO
 * days ("due 2026-06-30"). Render those as "30 Jun" (year only when it's
 * not this year) so old and new rows read the same.
 */
export function humanizeIsoDays(text, now = new Date()) {
  if (typeof text !== "string") return text;
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (whole, y, m, d) => {
    const month = MONTHS[Number(m) - 1];
    if (!month) return whole;
    const day = `${Number(d)} ${month}`;
    return Number(y) === now.getFullYear() ? day : `${day} ${y}`;
  });
}
