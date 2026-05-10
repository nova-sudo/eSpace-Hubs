/**
 * Email service abstraction. Swap-in interface — production gets a
 * real provider in M8 (nodemailer + SES / Resend / Postmark).
 *
 * Until then, the dev sender just LOGS the message and the link.
 * Calling code shouldn't need to change when the real provider lands;
 * only this file gets a different implementation.
 *
 * Intentionally not throwing on send failure — auth flows shouldn't
 * break if the email infrastructure is down. Caller should still
 * confirm "request received" to the user (no enumeration), and ops
 * gets the failure via the audit log + structured error.
 */

import { logger } from "./logger.js";

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text body. HTML lands when the real provider does. */
  body: string;
}

export interface EmailService {
  send(msg: EmailMessage): Promise<{ ok: true } | { ok: false; reason: string }>;
}

class DevLoggingEmailService implements EmailService {
  async send(msg: EmailMessage) {
    logger.info(
      {
        to: msg.to,
        subject: msg.subject,
        body: msg.body,
      },
      "[email · dev] would send",
    );
    return { ok: true as const };
  }
}

// Single shared instance. M8 swaps the constructor here based on
// NODE_ENV / a SMTP_* env block.
export const emailService: EmailService = new DevLoggingEmailService();
