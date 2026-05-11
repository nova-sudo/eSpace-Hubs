/**
 * Email transport for the API.
 *
 * Two modes, picked at module-load time based on env:
 *
 *   1. log        — RESEND_API_KEY unset. Renders the email to the
 *                   structured log and returns ok. Default for fresh
 *                   dev checkouts that don't have a Resend account.
 *
 *   2. resend     — RESEND_API_KEY set. Sends via Resend. Within this
 *                   mode RESEND_DOMAIN_MODE picks the From identity:
 *                     - sandbox  → onboarding@resend.dev. No DNS
 *                                  required; only addresses verified
 *                                  in the Resend dashboard can receive.
 *                     - verified → RESEND_FROM_EMAIL on an MX/DKIM-
 *                                  verified domain. Production path.
 *
 * Failures are surfaced via the return value, not thrown. Auth flows
 * (invite, password reset) call this in best-effort mode — the user
 * sees "request received" regardless, and ops sees the failure in
 * the audit log + warn-level log line. This preserves email-
 * enumeration resistance (a successful and failed-to-send request
 * look the same to the caller).
 */

import { Resend } from "resend";
import { logger } from "./logger.js";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body — always required as the deliverability-safe fallback. */
  text: string;
  /** Optional HTML body. Resend uses this when present; log mode prints it. */
  html?: string;
  /** Optional Reply-To override (e.g. for support flows). */
  replyTo?: string;
}

export type EmailResult =
  | { ok: true; id?: string }
  | { ok: false; reason: string };

export interface EmailService {
  send(msg: EmailMessage): Promise<EmailResult>;
}

// ─── log-only transport ───────────────────────────────────────────────

class LogEmailService implements EmailService {
  async send(msg: EmailMessage): Promise<EmailResult> {
    logger.info(
      {
        mode: "log",
        to: msg.to,
        subject: msg.subject,
        textPreview: msg.text.slice(0, 500),
      },
      "[email] dev-mode would send (RESEND_API_KEY not set)",
    );
    return { ok: true as const };
  }
}

// ─── Resend transport ─────────────────────────────────────────────────

interface ResendConfig {
  apiKey: string;
  /** "Display Name <user@domain>" formatted From. */
  from: string;
  mode: "sandbox" | "verified";
}

class ResendEmailService implements EmailService {
  private client: Resend;
  private from: string;
  private mode: "sandbox" | "verified";

  constructor(cfg: ResendConfig) {
    this.client = new Resend(cfg.apiKey);
    this.from = cfg.from;
    this.mode = cfg.mode;
  }

  async send(msg: EmailMessage): Promise<EmailResult> {
    try {
      const r = await this.client.emails.send({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
        ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
      });
      if (r.error) {
        logger.warn(
          {
            mode: this.mode,
            to: msg.to,
            subject: msg.subject,
            code: r.error.name,
            message: r.error.message,
          },
          "[email] resend send returned error",
        );
        return { ok: false, reason: r.error.message };
      }
      logger.info(
        {
          mode: this.mode,
          to: msg.to,
          subject: msg.subject,
          id: r.data?.id,
        },
        "[email] sent",
      );
      return { ok: true, ...(r.data?.id ? { id: r.data.id } : {}) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          mode: this.mode,
          to: msg.to,
          subject: msg.subject,
          message,
        },
        "[email] resend send threw",
      );
      return { ok: false, reason: message };
    }
  }
}

// ─── module factory ───────────────────────────────────────────────────

function buildEmailService(): EmailService {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return new LogEmailService();
  }
  const mode =
    process.env.RESEND_DOMAIN_MODE?.trim().toLowerCase() === "verified"
      ? "verified"
      : "sandbox";
  const fromName = process.env.RESEND_FROM_NAME?.trim() || "eSpace Dev Hub";

  let fromEmail: string;
  if (mode === "verified") {
    const envEmail = process.env.RESEND_FROM_EMAIL?.trim();
    if (!envEmail) {
      logger.warn(
        "[email] RESEND_DOMAIN_MODE=verified but RESEND_FROM_EMAIL is empty — falling back to sandbox sender",
      );
      fromEmail = "onboarding@resend.dev";
    } else {
      fromEmail = envEmail;
    }
  } else {
    // Sandbox: hard-coded sender Resend allows without DNS verification.
    fromEmail = "onboarding@resend.dev";
  }

  logger.info(
    { mode, from: `${fromName} <${fromEmail}>` },
    "[email] initialising Resend transport",
  );
  return new ResendEmailService({
    apiKey,
    from: `${fromName} <${fromEmail}>`,
    mode,
  });
}

export const emailService: EmailService = buildEmailService();

// ─── compatibility shim ───────────────────────────────────────────────

/**
 * Pre-M8 callers shipped `{to, subject, body}`. The new contract is
 * `{to, subject, text, html?}`. This shim accepts either shape so
 * existing call sites in auth/controller.ts can adopt HTML
 * incrementally without a wholesale rewrite.
 */
export async function sendEmail(
  msg:
    | EmailMessage
    | { to: string; subject: string; body: string; html?: string; replyTo?: string },
): Promise<EmailResult> {
  if ("text" in msg) {
    return emailService.send(msg);
  }
  return emailService.send({
    to: msg.to,
    subject: msg.subject,
    text: msg.body,
    ...(msg.html ? { html: msg.html } : {}),
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
  });
}
