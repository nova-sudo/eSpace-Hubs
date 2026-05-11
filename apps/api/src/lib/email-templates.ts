/**
 * Email templates — invite + password-reset.
 *
 * Each template returns both `text` and `html` bodies. Text is the
 * deliverability-safe canonical version; html is a minimal branded
 * wrapper around the same content. No external CSS, no images — keeps
 * the body small enough that Gmail/Outlook won't truncate or scan-warn.
 *
 * Branding is intentionally subtle (one accent rule, mono labels) so
 * the email matches the dashboard's voice without trying to be a
 * marketing piece.
 */

/** Escape a string so it's safe to drop into an HTML attribute or text node. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ShellOptions {
  preheader: string;
  /** Inner HTML for the body block (already escaped). */
  bodyHtml: string;
}

function shell({ preheader, bodyHtml }: ShellOptions): string {
  // Hidden preheader text shows in inbox previews next to the subject.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>eSpace Dev Hub</title></head>
<body style="margin:0;padding:0;background:#f1eee6;color:#1c1c1c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${esc(preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f1eee6;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background:#ffffff;border:1px solid #d8d2c2;border-radius:6px;">
        <tr><td style="padding:24px 28px 16px 28px;border-bottom:1px solid #ece6d6;">
          <div style="font-weight:600;font-size:16px;letter-spacing:-0.3px;color:#1c1c1c;">
            eSpace<span style="color:#0a7a5a;">/</span>DevHub
          </div>
        </td></tr>
        <tr><td style="padding:24px 28px;font-size:14px;line-height:1.6;color:#1c1c1c;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #ece6d6;font-size:11px;color:#7a7568;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
          Sent by eSpace Dev Hub · If you weren't expecting this, you can safely ignore the message.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

interface InviteVars {
  displayName: string;
  orgName: string;
  acceptUrl: string;
  expiresInDays: number;
  inviterDisplayName?: string | null;
}

export function renderInviteEmail(vars: InviteVars): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `You're invited to ${vars.orgName} on eSpace Dev Hub`;
  const inviter = vars.inviterDisplayName
    ? ` ${vars.inviterDisplayName} invited you to join`
    : ` You're invited to join`;
  const text = [
    `Hi ${vars.displayName},`,
    ``,
    `${inviter} ${vars.orgName} on eSpace Dev Hub.`,
    ``,
    `Activate your account here:`,
    vars.acceptUrl,
    ``,
    `This link expires in ${vars.expiresInDays} day${vars.expiresInDays === 1 ? "" : "s"}.`,
    ``,
    `If you weren't expecting this, ignore the message — the link will silently expire.`,
  ].join("\n");
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${esc(vars.displayName)},</p>
    <p style="margin:0 0 16px 0;">${esc(inviter.trim())} <strong>${esc(vars.orgName)}</strong> on eSpace Dev Hub.</p>
    <p style="margin:0 0 24px 0;">
      <a href="${esc(vars.acceptUrl)}" style="display:inline-block;padding:10px 18px;background:#0a7a5a;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:600;font-size:13px;">
        Activate your account
      </a>
    </p>
    <p style="margin:0 0 8px 0;font-size:12px;color:#6e6a5e;">Or paste this link into your browser:</p>
    <p style="margin:0 0 16px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all;color:#3a3833;">${esc(vars.acceptUrl)}</p>
    <p style="margin:0;color:#6e6a5e;font-size:12px;">This link expires in ${vars.expiresInDays} day${vars.expiresInDays === 1 ? "" : "s"}.</p>
  `;
  return {
    subject,
    text,
    html: shell({ preheader: `Activate your eSpace Dev Hub account`, bodyHtml }),
  };
}

interface PasswordResetVars {
  displayName: string;
  resetUrl: string;
  expiresInHours: number;
  ip?: string | null;
  userAgent?: string | null;
}

export function renderPasswordResetEmail(vars: PasswordResetVars): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `Reset your eSpace Dev Hub password`;
  const text = [
    `Hi ${vars.displayName},`,
    ``,
    `A password reset was requested for your eSpace Dev Hub account.`,
    ``,
    `Reset link:`,
    vars.resetUrl,
    ``,
    `This link expires in ${vars.expiresInHours} hour${vars.expiresInHours === 1 ? "" : "s"}.`,
    ``,
    `If you didn't request this, you can ignore the email — the link will silently expire and your current password keeps working.`,
  ].join("\n");
  const metaLines: string[] = [];
  if (vars.ip) metaLines.push(`IP: ${vars.ip}`);
  if (vars.userAgent) metaLines.push(`Browser: ${vars.userAgent}`);
  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hi ${esc(vars.displayName)},</p>
    <p style="margin:0 0 16px 0;">A password reset was requested for your eSpace Dev Hub account.</p>
    <p style="margin:0 0 24px 0;">
      <a href="${esc(vars.resetUrl)}" style="display:inline-block;padding:10px 18px;background:#0a7a5a;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:600;font-size:13px;">
        Reset your password
      </a>
    </p>
    <p style="margin:0 0 8px 0;font-size:12px;color:#6e6a5e;">Or paste this link into your browser:</p>
    <p style="margin:0 0 16px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all;color:#3a3833;">${esc(vars.resetUrl)}</p>
    <p style="margin:0 0 8px 0;color:#6e6a5e;font-size:12px;">This link expires in ${vars.expiresInHours} hour${vars.expiresInHours === 1 ? "" : "s"}.</p>
    ${
      metaLines.length > 0
        ? `<p style="margin:16px 0 0 0;padding:12px;background:#f7f3e9;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#3a3833;">${esc(metaLines.join(" · "))}</p>`
        : ""
    }
    <p style="margin:16px 0 0 0;color:#6e6a5e;font-size:12px;">If you didn't request this, ignore the email — the link will silently expire.</p>
  `;
  return {
    subject,
    text,
    html: shell({ preheader: `Reset your eSpace Dev Hub password`, bodyHtml }),
  };
}
