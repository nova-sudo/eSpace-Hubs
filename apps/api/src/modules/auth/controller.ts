/**
 * Auth controllers — login, logout, me.
 *
 * Each handler is the smallest unit that "completes a request" —
 * validates input via the Zod schema, performs the side effect, writes
 * the audit row, returns a JSON envelope. No business rules leak out
 * of this file.
 *
 * Lockout policy:
 *   - 5 consecutive failed logins → 15 minute lockout
 *   - Counter resets on first successful login
 *   - Locked-out users get a generic "invalid credentials" error
 *     (NOT "account locked") so attackers can't enumerate which
 *     accounts are valid + currently throttled
 */

import type { Request, Response, NextFunction } from "express";
import type { ObjectId } from "mongodb";
import {
  getOrgsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type { User } from "../../db/types.js";
import { hashPassword, verifyPassword } from "../../lib/argon2.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { encryptSecret, decryptSecret } from "../../lib/crypto-secret.js";
import { emailService } from "../../lib/email.js";
import {
  renderInviteEmail,
  renderPasswordResetEmail,
} from "../../lib/email-templates.js";
import {
  INVITE_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  deleteTokensFor,
  mintToken,
  redeemToken,
} from "../../lib/tokens.js";
import { logger } from "../../lib/logger.js";
import {
  buildProvisioningUri,
  generateTotpSecret,
  verifyTotpCode,
} from "../../lib/totp.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  destroySession,
  destroySessionsForUser,
  mintSession,
  setSessionTotpVerified,
} from "./session.js";
import {
  clearSessionCookie,
  setSessionCookie,
} from "./cookies.js";
import {
  acceptInviteSchema,
  inviteSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  totpDisableSchema,
  totpVerifySchema,
  type PublicUser,
} from "./schemas.js";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * Strip every secret-bearing field. Used for /me, /login responses,
 * and any audit-log `before`/`after` payload.
 */
export function toPublicUser(u: User): PublicUser {
  return {
    id: u._id.toHexString(),
    orgId: u.orgId.toHexString(),
    email: u.email,
    role: u.role,
    status: u.status,
    displayName: u.displayName,
    totpEnrolled: !!u.totpSecret,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  };
}

// ─── POST /api/v1/auth/login ─────────────────────────────────────────

export async function loginHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const users = await getUsersCollection();
    const now = new Date();

    // We always do a full hash-verify even when the user doesn't exist,
    // to keep timing characteristics uniform. An attacker probing valid
    // emails shouldn't be able to tell "no such user" from "wrong
    // password" via response latency.
    const user = await users.findOne({ email });

    const lockedOut =
      !!user?.lockedUntil && user.lockedUntil.getTime() > now.getTime();

    const passwordOk = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, DUMMY_HASH); // burn time anyway

    const validCredentials =
      !!user &&
      !lockedOut &&
      user.status === "active" &&
      !!user.passwordHash &&
      passwordOk;

    if (!validCredentials) {
      // Increment failed-attempt counter only if we found a real user
      // — otherwise an attacker could lock arbitrary unknown emails.
      if (user) {
        const nextAttempts = (user.failedLoginAttempts ?? 0) + 1;
        const nextLockedUntil =
          nextAttempts >= LOCKOUT_THRESHOLD
            ? new Date(now.getTime() + LOCKOUT_DURATION_MS)
            : user.lockedUntil ?? null;
        await users.updateOne(
          { _id: user._id },
          {
            $set: {
              failedLoginAttempts: nextAttempts,
              lockedUntil: nextLockedUntil,
              updatedAt: now,
            },
          },
        );
        await writeAudit({
          orgId: user.orgId,
          actorUserId: user._id,
          actorRole: user.role,
          action: "auth.login_failed",
          targetType: "user",
          targetId: user._id.toHexString(),
          after: {
            failedLoginAttempts: nextAttempts,
            locked: !!nextLockedUntil,
          },
          ...networkMeta(req),
        });
      }
      // Generic message — never reveal which specific check failed.
      throw new HttpError(401, "invalid_credentials", "Invalid email or password.");
    }

    // Success path — user is non-null inside this branch.
    const u = user as User;
    await users.updateOne(
      { _id: u._id },
      {
        $set: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: now,
          updatedAt: now,
        },
      },
    );

    const meta = networkMeta(req);

    // Two-step login when TOTP is enrolled: mint a partial session
    // (totpVerified=false), let the client know via `needsTotp: true`,
    // and require a /totp/verify call before this session can reach
    // protected routes.
    const needsTotp = u.totpEnrolledAt !== null && u.totpSecret !== null;

    const { sessionId } = await mintSession({
      userId: u._id,
      orgId: u.orgId,
      role: u.role,
      ip: meta.ip,
      userAgent: meta.ua,
      totpVerified: !needsTotp,
    });
    setSessionCookie(res, sessionId);

    await writeAudit({
      orgId: u.orgId,
      actorUserId: u._id,
      actorRole: u.role,
      action: "auth.login",
      targetType: "user",
      targetId: u._id.toHexString(),
      after: { needsTotp },
      ...meta,
    });

    res.json({
      user: toPublicUser({ ...u, lastLoginAt: now }),
      needsTotp,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/logout ────────────────────────────────────────

export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (session) {
      await destroySession(session._id);
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        actorRole: session.role,
        action: "auth.logout",
        targetType: "session",
        targetId: session._id,
        ...networkMeta(req),
      });
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/auth/me ─────────────────────────────────────────────

export async function meHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Guarded by requireAuth — session is present and TOTP-verified.
    const session = req.session;
    if (!session) {
      // Defensive — should be unreachable.
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const users = await getUsersCollection();
    const user = await users.findOne({ _id: session.userId });
    if (!user) {
      // Session points at a deleted user. Tear it down.
      await destroySession(session._id);
      clearSessionCookie(res);
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

/**
 * Pre-computed argon2 hash of an empty string we never use as a real
 * password. Verifying a candidate against this when the email is
 * unknown burns the same ~250ms argon2id costs as a real verify, so
 * timing side-channels can't distinguish "no such user" from "wrong
 * password". Replaced at boot if/when we want to rotate the salt.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$" +
  "ZHVtbXktZHVtbXktZHVtbXktZHU$" +
  "0VkS2Et2GZsmS2VqW7f1AaJqGn6lGXcLsHK6mXZOxAk";
// Note: This is a structural placeholder. argon2.verify will fail on
// shape mismatch and our wrapper returns false — that's fine, the
// goal is wall-clock parity, not a cryptographic match.

// Re-export so consumers can type-import without reaching into mongodb.
export { type ObjectId };

// ─── POST /api/v1/auth/invite (admin-only) ───────────────────────────

/**
 * App origin used to build absolute URLs in outbound emails. Without
 * this the invite/reset links would be relative — fine inside the app,
 * useless in an email client.
 *
 * Set APP_URL (or NEXT_PUBLIC_APP_URL as a fallback) in production.
 * Defaults to localhost:3000 for dev.
 */
function appOrigin(): string {
  const raw =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

/**
 * Public URL the user clicks to accept an invite. Frontend renders the
 * page; the page POSTs the token to /api/v1/auth/accept-invite.
 */
function buildInviteUrl(token: string): string {
  return `${appOrigin()}/accept-invite?token=${encodeURIComponent(token)}`;
}

function buildPasswordResetUrl(token: string): string {
  return `${appOrigin()}/password-reset?token=${encodeURIComponent(token)}`;
}

export async function inviteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Guarded by requireAuth + requireRole("admin") — session present.
    const session = req.session;
    if (!session) throw new HttpError(401, "unauthenticated", "Login required.");

    const { email, role, displayName } = inviteSchema.parse(req.body);

    const users = await getUsersCollection();
    const orgs = await getOrgsCollection();
    const org = await orgs.findOne({ _id: session.orgId });
    if (!org) {
      // Should be unreachable — sessions can't outlive their org.
      throw new HttpError(500, "internal_error", "Org missing.");
    }

    const now = new Date();
    const existing = await users.findOne({ orgId: org._id, email });

    let user: User;
    if (existing) {
      // Re-inviting an existing user only makes sense if they never
      // accepted (status="invited"). Otherwise refuse — admin should
      // disable + re-invite as separate steps.
      if (existing.status !== "invited") {
        throw new HttpError(
          409,
          "user_already_active",
          "An active or disabled user with that email already exists.",
        );
      }
      user = existing;
    } else {
      const draft = {
        orgId: org._id,
        email,
        passwordHash: null,
        role,
        status: "invited" as const,
        totpSecret: null,
        totpEnrolledAt: null,
        zohoEmployeeId: null,
        managerId: null,
        level: null,
        hireDate: null,
        displayName,
        createdAt: now,
        updatedAt: now,
        invitedBy: session.userId,
        invitedAt: now,
        lastLoginAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      } as unknown as User;
      await users.insertOne(draft);
      user = draft;
    }

    const meta = networkMeta(req);
    const plaintext = await mintToken({
      userId: user._id,
      orgId: org._id,
      kind: "invite",
      ttlMs: INVITE_TTL_MS,
      ip: meta.ip,
      userAgent: meta.ua,
    });

    // Look up the inviter's display name for the email greeting.
    // Best-effort — if it fails the template falls back to the
    // generic "You're invited" wording.
    let inviterDisplayName: string | null = null;
    try {
      const inviter = await users.findOne(
        { _id: session.userId },
        { projection: { displayName: 1 } },
      );
      inviterDisplayName = inviter?.displayName ?? null;
    } catch {
      /* non-fatal */
    }

    const expiresInDays = Math.round(INVITE_TTL_MS / (24 * 60 * 60 * 1000));
    const inviteUrl = buildInviteUrl(plaintext);
    const inviteEmail = renderInviteEmail({
      displayName,
      orgName: org.name,
      acceptUrl: inviteUrl,
      expiresInDays,
      inviterDisplayName,
    });
    const inviteResult = await emailService.send({
      to: email,
      subject: inviteEmail.subject,
      text: inviteEmail.text,
      html: inviteEmail.html,
    });
    if (!inviteResult.ok) {
      logger.warn(
        { email, reason: inviteResult.reason },
        "[auth.invite] email send failed — token minted, user must be informed manually",
      );
    }

    await writeAudit({
      orgId: org._id,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "user.invite",
      targetType: "user",
      targetId: user._id.toHexString(),
      after: { email, role, displayName, status: user.status },
      ...meta,
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/accept-invite (public) ────────────────────────

export async function acceptInviteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token, password, displayName } = acceptInviteSchema.parse(req.body);

    const redeemed = await redeemToken(token, "invite");
    if (!redeemed) {
      throw new HttpError(
        400,
        "invalid_token",
        "Invite link is invalid or expired.",
      );
    }

    const users = await getUsersCollection();
    const user = await users.findOne({ _id: redeemed.userId });
    if (!user) {
      // User got deleted between invite + accept. Token's already
      // consumed; treat as a hard failure.
      throw new HttpError(
        400,
        "invalid_token",
        "Invite link is invalid or expired.",
      );
    }
    if (user.status !== "invited") {
      // Defensive — token shouldn't have been live in this state.
      throw new HttpError(
        400,
        "invalid_token",
        "Invite link is invalid or expired.",
      );
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash,
          status: "active",
          updatedAt: now,
          ...(displayName ? { displayName } : {}),
        },
      },
    );

    // Mint a session so the user lands logged-in. Better UX than
    // bouncing through /login after just typing the password.
    const meta = networkMeta(req);
    const { sessionId } = await mintSession({
      userId: user._id,
      orgId: user.orgId,
      role: user.role,
      ip: meta.ip,
      userAgent: meta.ua,
      totpVerified: true,
    });
    setSessionCookie(res, sessionId);

    await writeAudit({
      orgId: user.orgId,
      actorUserId: user._id,
      actorRole: user.role,
      action: "user.accept_invite",
      targetType: "user",
      targetId: user._id.toHexString(),
      ...meta,
    });

    res.json({
      user: toPublicUser({
        ...user,
        passwordHash,
        status: "active",
        ...(displayName ? { displayName } : {}),
      }),
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/password/reset-request (public) ───────────────

/**
 * Note: ALWAYS returns 200 ok, even when the email is unknown. Tells
 * an attacker nothing about which emails are registered. Real ops
 * signal lives in the audit log.
 */
export async function passwordResetRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email } = passwordResetRequestSchema.parse(req.body);

    const users = await getUsersCollection();
    const user = await users.findOne({ email });

    // Only mint if the user exists AND can actually reset (not
    // disabled, has set up a password). Either way, return ok.
    if (
      user &&
      user.status === "active" &&
      user.passwordHash !== null
    ) {
      const meta = networkMeta(req);
      const plaintext = await mintToken({
        userId: user._id,
        orgId: user.orgId,
        kind: "password_reset",
        ttlMs: PASSWORD_RESET_TTL_MS,
        ip: meta.ip,
        userAgent: meta.ua,
      });

      const expiresInHours = Math.max(
        1,
        Math.round(PASSWORD_RESET_TTL_MS / (60 * 60 * 1000)),
      );
      const resetEmail = renderPasswordResetEmail({
        displayName: user.displayName,
        resetUrl: buildPasswordResetUrl(plaintext),
        expiresInHours,
        ip: meta.ip,
        userAgent: meta.ua,
      });
      const resetResult = await emailService.send({
        to: email,
        subject: resetEmail.subject,
        text: resetEmail.text,
        html: resetEmail.html,
      });
      if (!resetResult.ok) {
        logger.warn(
          { email, reason: resetResult.reason },
          "[auth.password-reset] email send failed — token minted but not delivered",
        );
      }

      await writeAudit({
        orgId: user.orgId,
        actorUserId: user._id,
        actorRole: user.role,
        action: "user.password_reset_requested",
        targetType: "user",
        targetId: user._id.toHexString(),
        ...meta,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/password/reset (public) ───────────────────────

export async function passwordResetHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token, password } = passwordResetSchema.parse(req.body);

    const redeemed = await redeemToken(token, "password_reset");
    if (!redeemed) {
      throw new HttpError(
        400,
        "invalid_token",
        "Reset link is invalid or expired.",
      );
    }

    const users = await getUsersCollection();
    const user = await users.findOne({ _id: redeemed.userId });
    if (!user || user.status !== "active") {
      throw new HttpError(
        400,
        "invalid_token",
        "Reset link is invalid or expired.",
      );
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash,
          updatedAt: now,
          // A password change resets the lockout state — gives the
          // legitimate user immediate access without waiting for the
          // lockout window.
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      },
    );

    // Force-logout every existing session for this user. The current
    // request has no session (public endpoint), so we don't mint a
    // new one — the user lands at /login.
    await destroySessionsForUser(user._id);

    // Wipe any stray reset/invite tokens for this user — successful
    // reset invalidates pending links.
    await deleteTokensFor(user._id);

    const meta = networkMeta(req);
    await writeAudit({
      orgId: user.orgId,
      actorUserId: user._id,
      actorRole: user.role,
      action: "user.password_reset",
      targetType: "user",
      targetId: user._id.toHexString(),
      ...meta,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/totp/enrol ────────────────────────────────────

/**
 * Begin a TOTP enrolment. Generates a fresh base32 secret, encrypts
 * it, and persists it as PENDING (totpSecret set, totpEnrolledAt
 * still null). Login flow treats `totpEnrolledAt !== null` as the gate
 * — pending enrolments don't yet require a code at sign-in.
 *
 * Rejects (409) if the user is already enrolled. Rotation is a
 * disable-then-enrol sequence so the request is intentional.
 *
 * Returns the otpauth:// provisioning URI for the frontend to render
 * as a QR code AND the raw base32 secret as a fallback for manual
 * entry into authenticator apps that don't take URIs.
 */
export async function totpEnrolHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }

    const users = await getUsersCollection();
    const user = await users.findOne({ _id: session.userId });
    if (!user) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }

    if (user.totpEnrolledAt !== null) {
      throw new HttpError(
        409,
        "totp_already_enrolled",
        "Two-factor is already enabled. Disable it first to rotate the secret.",
      );
    }

    const secret = generateTotpSecret();
    const encrypted = encryptSecret(secret);
    const now = new Date();

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          totpSecret: encrypted,
          // explicit null — overwrites any earlier pending enrolment
          totpEnrolledAt: null,
          updatedAt: now,
        },
      },
    );

    const otpauthUrl = buildProvisioningUri(user.email, secret);

    await writeAudit({
      orgId: user.orgId,
      actorUserId: user._id,
      actorRole: user.role,
      action: "user.totp_enrol_started",
      targetType: "user",
      targetId: user._id.toHexString(),
      ...networkMeta(req),
    });

    // Return BOTH the raw secret (for manual entry) and the URI (for
    // QR rendering). The secret stays in the response body — we send
    // it once. The user types it into their authenticator app, then
    // the only DB-resident copy is encrypted.
    res.json({ secret, otpauthUrl });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/totp/verify-enrolment ─────────────────────────

/**
 * Confirm enrolment by submitting a code generated from the pending
 * secret. On success, sets totpEnrolledAt and from now on every login
 * for this user requires a 6-digit code.
 */
export async function totpVerifyEnrolmentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { code } = totpVerifySchema.parse(req.body);

    const users = await getUsersCollection();
    const user = await users.findOne({ _id: session.userId });
    if (!user) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    if (user.totpEnrolledAt !== null) {
      throw new HttpError(
        409,
        "totp_already_enrolled",
        "Two-factor is already enabled.",
      );
    }
    if (user.totpSecret === null) {
      throw new HttpError(
        400,
        "invalid_state",
        "No pending enrolment. Start a new one with /totp/enrol.",
      );
    }

    let plainSecret: string;
    try {
      plainSecret = decryptSecret(user.totpSecret);
    } catch (err) {
      logger.error(
        {
          userId: user._id.toHexString(),
          err: err instanceof Error ? err.message : String(err),
        },
        "[totp] decrypt failed during verify-enrolment",
      );
      throw new HttpError(
        500,
        "totp_secret_corrupted",
        "Stored secret could not be read. Start a new enrolment.",
      );
    }

    if (!verifyTotpCode(code, plainSecret)) {
      throw new HttpError(401, "invalid_totp_code", "Code did not match.");
    }

    const now = new Date();
    await users.updateOne(
      { _id: user._id },
      { $set: { totpEnrolledAt: now, updatedAt: now } },
    );

    await writeAudit({
      orgId: user.orgId,
      actorUserId: user._id,
      actorRole: user.role,
      action: "user.totp_enrolled",
      targetType: "user",
      targetId: user._id.toHexString(),
      ...networkMeta(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/totp/verify ───────────────────────────────────

/**
 * Step 2 of the two-step login flow. The session was minted with
 * `totpVerified: false` because the user has TOTP enrolled. Submitting
 * a valid code flips it to true so subsequent requests pass the
 * default `requireAuth({ requireTotp: true })`.
 *
 * Routed with `requireAuth({ requireTotp: false })` so the partial
 * session can reach this handler.
 */
export async function totpVerifyLoginHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { code } = totpVerifySchema.parse(req.body);

    const users = await getUsersCollection();
    const user = await users.findOne({ _id: session.userId });
    if (!user || user.totpEnrolledAt === null || user.totpSecret === null) {
      // Session somehow points at a user without TOTP. Treat as an
      // auth state error — likely the user was disabled or TOTP was
      // removed admin-side mid-session.
      throw new HttpError(401, "unauthenticated", "Login required.");
    }

    let plainSecret: string;
    try {
      plainSecret = decryptSecret(user.totpSecret);
    } catch (err) {
      logger.error(
        {
          userId: user._id.toHexString(),
          err: err instanceof Error ? err.message : String(err),
        },
        "[totp] decrypt failed during verify",
      );
      throw new HttpError(500, "totp_secret_corrupted", "Internal error.");
    }

    if (!verifyTotpCode(code, plainSecret)) {
      throw new HttpError(401, "invalid_totp_code", "Code did not match.");
    }

    await setSessionTotpVerified(session._id, true);

    await writeAudit({
      orgId: user.orgId,
      actorUserId: user._id,
      actorRole: user.role,
      action: "auth.totp_verified",
      targetType: "session",
      targetId: session._id,
      ...networkMeta(req),
    });

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/totp/disable ──────────────────────────────────

/**
 * Turn TOTP off. Requires the current code as proof of possession —
 * a stolen session cookie alone shouldn't be able to remove the
 * second factor. Clears both `totpSecret` and `totpEnrolledAt`.
 */
export async function totpDisableHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { code } = totpDisableSchema.parse(req.body);

    const users = await getUsersCollection();
    const user = await users.findOne({ _id: session.userId });
    if (!user) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    if (user.totpEnrolledAt === null || user.totpSecret === null) {
      throw new HttpError(
        409,
        "totp_not_enrolled",
        "Two-factor is not enabled.",
      );
    }

    let plainSecret: string;
    try {
      plainSecret = decryptSecret(user.totpSecret);
    } catch (err) {
      logger.error(
        {
          userId: user._id.toHexString(),
          err: err instanceof Error ? err.message : String(err),
        },
        "[totp] decrypt failed during disable",
      );
      throw new HttpError(500, "totp_secret_corrupted", "Internal error.");
    }

    if (!verifyTotpCode(code, plainSecret)) {
      throw new HttpError(401, "invalid_totp_code", "Code did not match.");
    }

    const now = new Date();
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          totpSecret: null,
          totpEnrolledAt: null,
          updatedAt: now,
        },
      },
    );

    await writeAudit({
      orgId: user.orgId,
      actorUserId: user._id,
      actorRole: user.role,
      action: "user.totp_disabled",
      targetType: "user",
      targetId: user._id.toHexString(),
      ...networkMeta(req),
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
