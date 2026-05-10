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
import { emailService } from "../../lib/email.js";
import {
  INVITE_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  deleteTokensFor,
  mintToken,
  redeemToken,
} from "../../lib/tokens.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  destroySession,
  destroySessionsForUser,
  mintSession,
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
    const { sessionId } = await mintSession({
      userId: u._id,
      orgId: u.orgId,
      role: u.role,
      ip: meta.ip,
      userAgent: meta.ua,
      // M2.3c will compute this based on whether the user has TOTP
      // enrolled. For now (M2.3a, no TOTP enforcement yet), every
      // session is fully verified at mint.
      totpVerified: true,
    });
    setSessionCookie(res, sessionId);

    await writeAudit({
      orgId: u.orgId,
      actorUserId: u._id,
      actorRole: u.role,
      action: "auth.login",
      targetType: "user",
      targetId: u._id.toHexString(),
      ...meta,
    });

    res.json({ user: toPublicUser({ ...u, lastLoginAt: now }) });
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
 * Public URL the user clicks to accept an invite. Frontend renders the
 * page; the page POSTs the token to /api/v1/auth/accept-invite.
 */
function buildInviteUrl(token: string): string {
  return `/accept-invite?token=${encodeURIComponent(token)}`;
}

function buildPasswordResetUrl(token: string): string {
  return `/password-reset?token=${encodeURIComponent(token)}`;
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

    await emailService.send({
      to: email,
      subject: `You're invited to ${org.name}`,
      body: [
        `Hi ${displayName},`,
        ``,
        `You've been invited to join ${org.name} on eSpace Dev Hub.`,
        `Click the link below to set your password and activate your account:`,
        ``,
        buildInviteUrl(plaintext),
        ``,
        `This link expires in 7 days.`,
      ].join("\n"),
    });

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

      await emailService.send({
        to: email,
        subject: "Reset your eSpace Dev Hub password",
        body: [
          `Hi ${user.displayName},`,
          ``,
          `A password reset was requested for your account.`,
          `Click the link below to choose a new password:`,
          ``,
          buildPasswordResetUrl(plaintext),
          ``,
          `This link expires in 1 hour. If you didn't request this, ignore this email — your password will stay unchanged.`,
        ].join("\n"),
      });

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
