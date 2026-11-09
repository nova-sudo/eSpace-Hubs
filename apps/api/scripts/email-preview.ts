/**
 * Render every email the API sends with sample data.
 *
 *   npm run email:preview -w apps/api                 → apps/api/.email-preview/*.html + index.html
 *   npm run email:preview -w apps/api -- --send me@x  → also emails each one to me@x over SMTP
 *
 * --send reads SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS (+ APP_URL for
 * the logo/link origin) from apps/api/.env. Sample names and goals are
 * invented; the wording mirrors the real notification copy.
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ObjectId } from "mongodb";
import nodemailer from "nodemailer";

import type { NotificationKind } from "../src/db/types.js";
import { ALL_NOTIFICATION_KINDS } from "../src/db/types.js";
import { renderNotificationEmail } from "../src/lib/notification-email.js";
import {
  renderDigestEmail,
  renderInviteEmail,
  renderPasswordResetEmail,
} from "../src/lib/email-templates.js";

const SAMPLES: Record<NotificationKind, { title: string; body: string }> = {
  goal_submitted: { title: "A goal needs your approval", body: 'Omar Khaled submitted "Reduce flaky tests" for your approval.' },
  approval_waiting: { title: "Approval waiting >24h: Reduce flaky tests", body: "Omar is still waiting on this one. Approving or sending it back unblocks their tracking for the week." },
  approval_queue_stale: { title: "3 approvals waiting over 3 days", body: "The oldest has been waiting since Mon 3 Nov." },
  user_pending_approval: { title: "New sign-up waiting for approval", body: "Youssef Nabil (youssef@espace.ws) signed up and can't use eSpace Hubs until an admin approves the account." },
  review_packet_submitted: { title: "A review packet was submitted", body: "Omar Khaled submitted their evidence document (6 goals) for review." },
  github_publish_requested: { title: "Publish «Weekly delivery log» to GitHub", body: 'Sara Ahmed asked you to publish "Weekly delivery log" as GitHub issues in espace/platform, one per period. Open it on your Goals page and choose Publish.' },
  goal_due_soon: { title: "Due soon: Review rounds log", body: "W46 is due Tue 11 Nov. Log this week's entry before the window closes." },
  assigned_goal_due_soon: { title: "Due soon: Weekly delivery log · W46", body: 'W46 of "Weekly delivery log" is due by Thu 13 Nov.' },
  goal_stale: { title: "No updates in 3 weeks: Mentoring sessions", body: "This tracker hasn't seen an entry in over 21 days. Windows that pass empty count against compliance — log the latest, or mark the goal delegated/untrackable if it no longer applies." },
  goal_overdue: { title: "Overdue: Incident write-up", body: "W45 was due Wed 5 Nov. You can still log it — it will show as late." },
  assigned_goal_overdue: { title: "Overdue: Weekly delivery log · W45", body: 'W45 of "Weekly delivery log" was due Thu 6 Nov. Sara Ahmed can see it\'s missing.' },
  goal_changes_requested: { title: 'Changes requested on "Reduce flaky tests"', body: "Sara Ahmed: \"Tighten tier 3 to a measurable target — 'fewer flakes' is hard to grade.\" Update the tracker and resubmit." },
  verdict_disputed: { title: "Omar Khaled disagrees with a grade", body: 'Omar Khaled disagreed with your "Meets" grade on "Reduce flaky tests".' },
  goal_approved: { title: '"Reduce flaky tests" was approved', body: "Sara Ahmed approved your tracker. Entries you log now count toward the goal." },
  manager_graded: { title: "Sara graded Ship review tooling: Exceeds", body: '"Great turnaround on the review bot — let\'s scale it to the mobile team." You can acknowledge the grade or dispute it from the goal.' },
  github_issues_published: { title: 'Omar Khaled published "Weekly delivery log" to GitHub', body: 'Omar Khaled published 12 periods of "Weekly delivery log" as GitHub issues in espace/platform.' },
  github_issue_closed: { title: "W45 closed on GitHub · Weekly delivery log", body: "Omar Khaled's linked issue was closed as completed and logged as W45's reading." },
  assigned_goal_assigned: { title: "New shared goal: Weekly delivery log", body: 'Sara Ahmed shared "Weekly delivery log" with you. It\'s on your Goals page under "Assigned to you".' },
  assigned_goal_shared: { title: "Shared with you: Weekly delivery log", body: 'Sara Ahmed gave you access to the progress of "Weekly delivery log".' },
  assigned_goal_updated: { title: "Shared goal updated: Weekly delivery log", body: 'Sara Ahmed changed the plan for "Weekly delivery log".' },
  assigned_goal_period_report: { title: "Weekly delivery log · W45: 7/9 submitted", body: "5 on time · 2 late · 2 missing." },
  tier_policy_updated: { title: "Grading criteria changed for Reduce flaky tests", body: "Sara Ahmed updated the tier ladder (goal code ENG-REL) that grades this goal. Check the new criteria before your next entry." },
  manager_changed: { title: "You now report to Sara Ahmed", body: "An admin moved you to Sara Ahmed's team. Your goals and history move with you." },
};

interface Rendered {
  name: string;
  subject: string;
  text: string;
  html: string;
}

function all(): Rendered[] {
  const out: Rendered[] = [
    { name: "invite", ...renderInviteEmail({ displayName: "Omar", orgName: "eSpace", acceptUrl: "https://espace-hubs.espace.ws/accept-invite?token=sample", expiresInDays: 7, inviterDisplayName: "Sara Ahmed" }) },
    { name: "password-reset", ...renderPasswordResetEmail({ displayName: "Omar", resetUrl: "https://espace-hubs.espace.ws/password-reset?token=sample", expiresInHours: 1, ip: "81.10.43.128", userAgent: "Chrome on macOS" }) },
    {
      name: "weekly-digest",
      ...renderDigestEmail({
        week: "W46",
        overdue: [{ title: "W45 check-in", when: "6 Nov" }, { title: "Incident write-up", when: "5 Nov" }],
        dueSoon: [{ title: "Review rounds log", when: "11 Nov" }, { title: "Mentoring session", when: "13 Nov" }, { title: "Q4 demo", when: "13 Nov" }],
        approvals: 1,
        sharedOwed: 2,
        unread: 4,
      }),
    },
  ];
  for (const kind of ALL_NOTIFICATION_KINDS) {
    const s = SAMPLES[kind];
    out.push({ name: kind, ...renderNotificationEmail({ _id: new ObjectId(), kind, title: s.title, body: s.body, data: null }) });
  }
  return out;
}

async function main() {
  const emails = all();
  const dir = join(process.cwd(), ".email-preview");
  mkdirSync(dir, { recursive: true });
  for (const e of emails) writeFileSync(join(dir, `${e.name}.html`), e.html);
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Email preview</title><body style="font-family:system-ui;padding:24px"><h1>${emails.length} emails</h1><ul>${emails
      .map((e) => `<li><a href="${e.name}.html">${e.name}</a> — ${e.subject.replace(/</g, "&lt;")}</li>`)
      .join("")}</ul></body>`,
  );
  console.log(`wrote ${emails.length} emails to ${dir}`);

  const i = process.argv.indexOf("--send");
  if (i === -1) return;
  const to = process.argv[i + 1];
  if (!to) throw new Error("--send needs an address");
  const { SMTP_HOST, SMTP_USER } = process.env;
  const SMTP_PASS = process.env.SMTP_PASS?.replace(/\s+/g, "");
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw new Error("SMTP_HOST / SMTP_USER / SMTP_PASS missing from apps/api/.env");
  const port = Number(process.env.SMTP_PORT || 465);
  const t = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  const from = `eSpace Hubs <${process.env.SMTP_FROM_EMAIL || SMTP_USER}>`;
  for (const [n, e] of emails.entries()) {
    await t.sendMail({ from, to, subject: `[preview ${n + 1}/${emails.length}] ${e.subject}`, text: e.text, html: e.html });
    console.log(`sent ${n + 1}/${emails.length} ${e.name}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
