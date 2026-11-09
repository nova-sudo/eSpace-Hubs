/**
 * Notification → email. Every inbox row also emails its recipient
 * ("Mirror", see docs/superpowers/specs/2026-11-09-email-notifications-design.md)
 * unless a rule below says otherwise. Pure: createNotification does the I/O.
 *
 * Header title = the row's title, paragraph = its body, so the wording
 * lives in one place (the caller). This table only adds the tint, the
 * button label and the footer reason. Typed as Record<NotificationKind,…>
 * so a new kind without an entry fails the build.
 */

import type { ObjectId } from "mongodb";
import type { NotificationKind } from "../db/types.js";
import { appOrigin } from "./app-url.js";
import { renderEmail, type EmailTone } from "./email-layout.js";
import { isMutableKind, type ResolvedNotificationPrefs } from "./notification-prefs.js";

interface KindEmail {
  tone: EmailTone;
  cta: string;
  reason: string;
}

const APPROVER = "You approve goals for your team.";
const OWNER = "You submitted this goal.";
const REMINDER = "Reminders are on for your goals.";
const CREATOR = "You created this shared goal.";
const ASSIGNEE = "This goal was shared with you.";

export const NOTIFICATION_EMAIL: Record<NotificationKind, KindEmail> = {
  // Waiting on you
  goal_submitted: { tone: "lemon", cta: "Review tracker", reason: APPROVER },
  approval_waiting: { tone: "lemon", cta: "Review tracker", reason: APPROVER },
  approval_queue_stale: { tone: "lemon", cta: "Open approvals", reason: APPROVER },
  user_pending_approval: { tone: "lemon", cta: "Review sign-up", reason: "You're an admin of your org." },
  review_packet_submitted: { tone: "lemon", cta: "Open packet", reason: "Someone on your team submitted a packet." },
  github_publish_requested: { tone: "lemon", cta: "Open the goal", reason: ASSIGNEE },
  // Deadlines
  goal_due_soon: { tone: "lemon", cta: "Log it", reason: REMINDER },
  assigned_goal_due_soon: { tone: "lemon", cta: "Fill it in", reason: REMINDER },
  goal_stale: { tone: "lemon", cta: "Open the goal", reason: REMINDER },
  // Overdue & pushback
  goal_overdue: { tone: "peach", cta: "Log it", reason: REMINDER },
  assigned_goal_overdue: { tone: "peach", cta: "Fill it in", reason: REMINDER },
  goal_changes_requested: { tone: "peach", cta: "Edit tracker", reason: OWNER },
  verdict_disputed: { tone: "peach", cta: "Open their board", reason: "You set this grade." },
  // Good news
  goal_approved: { tone: "mint", cta: "Open the goal", reason: OWNER },
  manager_graded: { tone: "mint", cta: "Open the goal", reason: "Your manager graded your goal." },
  github_issues_published: { tone: "mint", cta: "Open progress", reason: CREATOR },
  github_issue_closed: { tone: "mint", cta: "Open progress", reason: CREATOR },
  // Updates
  assigned_goal_assigned: { tone: "sky", cta: "Open the goal", reason: ASSIGNEE },
  assigned_goal_shared: { tone: "sky", cta: "Open progress", reason: "This goal's progress was shared with you." },
  assigned_goal_updated: { tone: "sky", cta: "See what changed", reason: ASSIGNEE },
  assigned_goal_period_report: { tone: "sky", cta: "Open progress", reason: CREATOR },
  tier_policy_updated: { tone: "sky", cta: "See the criteria", reason: "This policy grades one of your goals." },
  manager_changed: { tone: "sky", cta: "Open eSpace Hubs", reason: "Your reporting line changed." },
};

export type NotificationEmailDecision =
  | { send: true }
  | { send: false; skip: "caller-opt-out" | "email-off" | "muted" | "no-recipient" };

export function decideNotificationEmail(i: {
  prefs: ResolvedNotificationPrefs;
  kind: NotificationKind;
  optOut: boolean;
  recipient: { email?: string | null; status?: string } | null;
}): NotificationEmailDecision {
  if (i.optOut) return { send: false, skip: "caller-opt-out" };
  if (!i.recipient?.email || i.recipient.status !== "active") return { send: false, skip: "no-recipient" };
  if (!i.prefs.email) return { send: false, skip: "email-off" };
  if (isMutableKind(i.kind) && i.prefs.muted.includes(i.kind)) return { send: false, skip: "muted" };
  return { send: true };
}

export function renderNotificationEmail(n: {
  _id: ObjectId;
  kind: NotificationKind;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}): { subject: string; text: string; html: string } {
  const cfg = NOTIFICATION_EMAIL[n.kind];
  const origin = appOrigin();
  const settings = `${origin}/email-settings`;
  const { html, text } = renderEmail({
    tone: cfg.tone,
    title: n.title,
    paragraphs: n.body ? [n.body] : [],
    cta: { label: cfg.cta, url: `${origin}/n/${n._id.toHexString()}` },
    footer: {
      reason: cfg.reason,
      manageUrl: settings,
      muteUrl: isMutableKind(n.kind) ? settings : null,
    },
    preheader: n.body || n.title,
  });
  return { subject: n.title, text, html };
}
