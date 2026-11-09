/**
 * Self-signup policy — pure pieces of POST /auth/signup.
 *
 *   - resolveSignupGate: free domain (email link proves ownership) vs
 *     org signup code (everyone else).
 *   - newSelfSignupUser: the row a self-signup starts as. Unverified
 *     (`pending_email`) but already holding dev access, so verifying
 *     the email is the only step between signup and the dev hub.
 *   - sendVerificationEmail: mint an `email_verify` token and send the
 *     link. Best-effort — a failed send never fails the signup; the
 *     user can resend from the inbox screen.
 */

import type { ObjectId } from "mongodb";
import { isFreeSignupDomain, parseFreeDomains } from "@espace-devhub/shared/auth";
import type { User } from "../../db/types.js";
import { HttpError } from "../../middleware/error-handler.js";
import type { EmailMessage, EmailResult } from "../../lib/email.js";
import { renderVerifyEmail } from "../../lib/email-templates.js";
import type { MintTokenInput } from "../../lib/tokens.js";

/** Verification links live 24h; resend mints a fresh one. */
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export type SignupGate = { kind: "free" } | { kind: "code"; code: string };

/** Domains whose owners sign up without a code (env SIGNUP_FREE_DOMAINS). */
export function configuredFreeDomains(): string[] {
  return parseFreeDomains(process.env.SIGNUP_FREE_DOMAINS);
}

export function resolveSignupGate(input: {
  email: string;
  signupCode?: string;
  freeDomains: readonly string[];
}): SignupGate {
  if (isFreeSignupDomain(input.email, input.freeDomains)) return { kind: "free" };
  const code = input.signupCode?.trim();
  if (!code) {
    throw new HttpError(
      400,
      "signup_code_required",
      "This email domain needs a signup code from your admin.",
    );
  }
  return { kind: "code", code };
}

export function newSelfSignupUser(input: {
  orgId: ObjectId;
  email: string;
  passwordHash: string;
  displayName: string;
  now: Date;
}): Omit<User, "_id"> {
  return {
    orgId: input.orgId,
    email: input.email,
    passwordHash: input.passwordHash,
    // Legacy single-role field still needs a value; real access comes
    // from `roles`.
    role: "member",
    roles: ["dev"],
    status: "pending_email",
    totpSecret: null,
    totpEnrolledAt: null,
    zohoEmployeeId: null,
    managerId: null,
    level: null,
    hireDate: null,
    displayName: input.displayName,
    createdAt: input.now,
    updatedAt: input.now,
    invitedBy: null,
    invitedAt: null,
    lastLoginAt: input.now,
    failedLoginAttempts: 0,
    lockedUntil: null,
    allowedHubs: ["dev"],
    primaryHub: "dev",
    onboardingCompletedAt: null,
    emailVerifiedAt: null,
    employeeId: null,
    department: null,
    engagement: null,
  };
}

export interface VerificationEmailDeps {
  mintToken: (input: MintTokenInput) => Promise<string>;
  send: (msg: EmailMessage) => Promise<EmailResult>;
  appUrl: string;
  orgName: string;
}

export async function sendVerificationEmail(
  deps: VerificationEmailDeps,
  user: { _id: ObjectId; orgId: ObjectId; email: string; displayName: string },
  meta: { ip: string | null; ua: string | null },
): Promise<EmailResult> {
  const token = await deps.mintToken({
    userId: user._id,
    orgId: user.orgId,
    kind: "email_verify",
    ttlMs: EMAIL_VERIFY_TTL_MS,
    ip: meta.ip,
    userAgent: meta.ua,
  });
  const verifyUrl = `${deps.appUrl.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  const mail = renderVerifyEmail({
    displayName: user.displayName,
    orgName: deps.orgName,
    verifyUrl,
  });
  try {
    return await deps.send({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
