/**
 * Account + digest emails. All render through the one branded layout
 * (lib/email-layout.ts); notification emails live in
 * lib/notification-email.ts.
 */

import { appOrigin } from "./app-url.js";
import { renderEmail, type EmailListRow } from "./email-layout.js";

interface Rendered {
  subject: string;
  text: string;
  html: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface InviteVars {
  displayName: string;
  orgName: string;
  acceptUrl: string;
  expiresInDays: number;
  inviterDisplayName?: string | null;
}

export function renderInviteEmail(vars: InviteVars): Rendered {
  const subject = `You're invited to ${vars.orgName} on eSpace Hubs`;
  const who = vars.inviterDisplayName
    ? `${vars.inviterDisplayName} invited you to join ${vars.orgName} on eSpace Hubs`
    : `You're invited to join ${vars.orgName} on eSpace Hubs`;
  const { html, text } = renderEmail({
    tone: "sky",
    title: `You're invited to ${vars.orgName}`,
    subtitle: who,
    paragraphs: [
      `Hi ${vars.displayName}, set a password to activate your account and start tracking your goals.`,
    ],
    note: `This link expires in ${plural(vars.expiresInDays, "day")}. If you weren't expecting it, ignore this email.`,
    cta: { label: "Activate your account", url: vars.acceptUrl },
    footer: { reason: `Someone at ${vars.orgName} invited this address.` },
    preheader: "Activate your eSpace Hubs account",
  });
  return { subject, text, html };
}

interface PasswordResetVars {
  displayName: string;
  resetUrl: string;
  expiresInHours: number;
  ip?: string | null;
  userAgent?: string | null;
}

export function renderPasswordResetEmail(vars: PasswordResetVars): Rendered {
  const meta = [vars.userAgent ? `from ${vars.userAgent}` : null, vars.ip ? `IP ${vars.ip}` : null]
    .filter(Boolean)
    .join(" · ");
  const { html, text } = renderEmail({
    tone: "sky",
    title: "Reset your password",
    subtitle: meta ? `Requested ${meta}` : "Requested just now",
    paragraphs: [
      `Hi ${vars.displayName}, use the button below to choose a new password. Your current password keeps working until you do.`,
    ],
    note: `This link expires in ${plural(vars.expiresInHours, "hour")}. If you didn't ask for this, ignore this email.`,
    cta: { label: "Reset your password", url: vars.resetUrl },
    footer: { reason: "A password reset was requested for this address." },
    preheader: "Reset your eSpace Hubs password",
  });
  return { subject: "Reset your eSpace Hubs password", text, html };
}

export interface DigestItem {
  title: string;
  when: string;
}

export interface DigestVars {
  week: string;
  overdue: DigestItem[];
  dueSoon: DigestItem[];
  approvals: number;
  sharedOwed: number;
  unread: number;
}

const DIGEST_ROWS = 10;

export function renderDigestEmail(v: DigestVars): Rendered {
  const rows = (items: DigestItem[], tone: EmailListRow["tone"]): EmailListRow[] =>
    items.slice(0, DIGEST_ROWS).map((d) => ({ label: d.title, badge: d.when, tone }));

  const summary = [
    v.overdue.length ? `${v.overdue.length} overdue` : null,
    `${v.dueSoon.length} due this week`,
    v.approvals ? plural(v.approvals, "approval") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const waiting: EmailListRow[] = [];
  if (v.approvals) waiting.push({ label: "Approvals waiting on you", badge: String(v.approvals), tone: "lemon" });
  if (v.sharedOwed) waiting.push({ label: "Shared-goal periods open or missing", badge: String(v.sharedOwed), tone: "lemon" });

  const { html, text } = renderEmail({
    tone: "sky",
    title: `Your week · ${v.week}`,
    subtitle: summary,
    list: [
      { heading: "Overdue", rows: rows(v.overdue, "peach") },
      { heading: "Due this week", rows: rows(v.dueSoon, "lemon") },
      ...(v.approvals ? [{ heading: "Waiting on you", rows: waiting }] : []),
      ...(!v.approvals && v.sharedOwed ? [{ heading: "Shared goals", rows: waiting }] : []),
    ],
    note: v.unread ? `${plural(v.unread, "unread notification")} in your inbox.` : null,
    cta: { label: "Open eSpace Hubs", url: appOrigin() },
    footer: { reason: "This is your Monday summary.", manageUrl: `${appOrigin()}/email-settings` },
    preheader: summary,
  });
  const subject = `eSpace Hubs weekly — ${v.overdue.length ? `${v.overdue.length} overdue, ` : ""}${v.dueSoon.length} due this week`;
  return { subject, text, html };
}
