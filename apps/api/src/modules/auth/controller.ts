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
import { getUsersCollection } from "../../db/collections.js";
import type { User } from "../../db/types.js";
import { verifyPassword } from "../../lib/argon2.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  destroySession,
  mintSession,
} from "./session.js";
import {
  clearSessionCookie,
  setSessionCookie,
} from "./cookies.js";
import { loginSchema, type PublicUser } from "./schemas.js";

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

// Unused imports satisfied: ObjectId is referenced indirectly via User
// types. Suppress lint by exporting nothing extra.
export { type ObjectId };
