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
  getSessionsCollection,
  getTrustedDevicesCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type { User } from "../../db/types.js";
import { hashPassword, verifyPassword } from "../../lib/argon2.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { encryptSecret, decryptSecret } from "../../lib/crypto-secret.js";
import {
  getEngagementConfig,
  toPublicEngagementConfig,
} from "../../lib/engagement-config.js";
import { emailService } from "../../lib/email.js";
import { appOrigin } from "../../lib/app-url.js";
import {
  renderInviteEmail,
  renderPasswordResetEmail,
} from "../../lib/email-templates.js";
import { DEFAULT_HUB_ID } from "@espace-devhub/shared/hubs";
import {
  effectiveCapabilities,
  effectiveRoles,
} from "../../lib/user-roles.js";
import {
  INVITE_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  deleteTokensFor,
  mintToken,
  findTokenAnyState,
  redeemToken,
} from "../../lib/tokens.js";
import {
  configuredFreeDomains,
  newSelfSignupUser,
  resolveSignupGate,
  sendVerificationEmail,
} from "./signup-policy.js";
import { verifyEmail } from "./email-verification.js";
import { loginSessionFlags } from "./login-flags.js";
import {
  checkTrustedDevice,
  countTrustedDevices,
  issueTrustedDevice,
  revokeTrustedDevices,
} from "./trusted-devices.js";
import { logger } from "../../lib/logger.js";
import {
  buildProvisioningUri,
  generateTotpSecret,
  verifyTotpCode,
} from "../../lib/totp.js";
import { HttpError } from "../../middleware/error-handler.js";
import { env } from "../../config/env.js";
import {
  CLEAR_BACKUP_CODES,
  consumeBackupCode,
  countRemainingBackupCodes,
  issueBackupCodes,
} from "./backup-codes.js";
import {
  destroySession,
  destroySessionsForUser,
  mintSession,
  requireTotpReverifyForOtherSessions,
  setSessionTotpEnrolled,
  setSessionTotpVerified,
} from "./session.js";
import {
  clearSessionCookie,
  clearTrustedCookie,
  readTrustedCookie,
  setSessionCookie,
  setTrustedCookie,
} from "./cookies.js";
import {
  acceptInviteSchema,
  companionTunnelRegisterSchema,
  inviteSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  profileUpdateSchema,
  signupSchema,
  totpEnrolVerifySchema,
  verifyEmailSchema,
  backupCodesRegenerateSchema,
  totpDisableSchema,
  totpLoginVerifySchema,
  totpReenrolConfirmSchema,
  totpReenrolStartSchema,
  type PublicUser,
} from "./schemas.js";
import { resolveCompanionPrincipal } from "../companion/bearer-auth.js";
import {
  ReenrolError,
  confirmReenrol,
  startReenrol,
  type ReenrolDeps,
} from "./totp-reenrol.js";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * Strip every secret-bearing field. Used for /me, /login responses,
 * and any audit-log `before`/`after` payload.
 */
export function toPublicUser(u: User): PublicUser {
  const roles = effectiveRoles(u);
  const caps = effectiveCapabilities(u);
  return {
    id: u._id.toHexString(),
    orgId: u.orgId.toHexString(),
    email: u.email,
    role: roles[0] ?? u.role,
    roles,
    capabilities: Array.from(caps),
    status: u.status,
    displayName: u.displayName,
    totpEnrolled: !!u.totpSecret,
    backupCodesRemaining: countRemainingBackupCodes(u.totpBackupCodes),
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    // M-OB fields. Null on pre-onboarding users; populated by the
    // /api/v1/onboarding handler on submit.
    onboardingCompletedAt: u.onboardingCompletedAt
      ? u.onboardingCompletedAt.toISOString()
      : null,
    employeeId: u.employeeId ?? null,
    department: u.department ?? null,
    primaryHub: u.primaryHub ?? null,
    engagement: u.engagement ?? "espace",
    // C7: normalise prefs to an always-present object with null for
    // unset fields, so the frontend store reads a stable shape.
    prefs: {
      aiProvider: u.prefs?.aiProvider ?? null,
      lastReviewDate: u.prefs?.lastReviewDate ?? null,
    },
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

    // Unverified self-signups (`pending_email`) can log in: their
    // session carries emailVerified=false, so requireAuth only admits
    // me / logout / resend-verification until the link is opened.
    const validCredentials =
      !!user &&
      !lockedOut &&
      (user.status === "active" || user.status === "pending_email") &&
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
    // A browser this user trusted after a TOTP code (≤ 30 days ago)
    // skips step 2. Someone else's cookie never counts.
    const totpRequired = u.totpEnrolledAt !== null && u.totpSecret !== null;
    const trustedDevice =
      totpRequired &&
      (await checkTrustedDevice(
        await getTrustedDevicesCollection(),
        readTrustedCookie(req),
        u._id,
        now,
      ));
    const flags = loginSessionFlags(u, trustedDevice);
    const { needsTotp } = flags;

    // Pin TOTP-enrolment and email-verification state at mint time —
    // requireAuth reads both on every request without a user lookup.
    const { sessionId } = await mintSession({
      userId: u._id,
      orgId: u.orgId,
      role: u.role,
      roles: effectiveRoles(u),
      ip: meta.ip,
      userAgent: meta.ua,
      totpVerified: flags.totpVerified,
      totpEnrolled: flags.totpEnrolled,
      emailVerified: flags.emailVerified,
    });
    setSessionCookie(res, sessionId);

    await writeAudit({
      orgId: u.orgId,
      actorUserId: u._id,
      actorRole: u.role,
      action: "auth.login",
      targetType: "user",
      targetId: u._id.toHexString(),
      after: { needsTotp, trustedDevice },
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
    // Name the manager for first-run copy. A disabled manager can't act,
    // so they read as "no manager" here too (same rule as approvals).
    let manager: PublicUser["manager"] = null;
    if (user.managerId) {
      const m = await users.findOne(
        { _id: user.managerId, orgId: user.orgId },
        { projection: { displayName: 1, email: 1, status: 1 } },
      );
      if (m && m.status !== "disabled") {
        manager = { id: m._id.toHexString(), displayName: m.displayName || m.email };
      }
    }
    res.json({ user: { ...toPublicUser(user), manager } });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/auth/me/engagement-config ───────────────────────────

/**
 * Returns the public (non-secret) integration config bound to the
 * current user's engagement. Used by the web layer to build OAuth
 * redirect URLs, Jira link bases, and similar — replacing the
 * `NEXT_PUBLIC_*` build-time env reads with a per-user runtime
 * lookup.
 *
 * Secret fields (GITHUB_CLIENT_SECRET, JENKINS_API_TOKEN) are
 * NEVER returned here. The OAuth exchange endpoint and the
 * server-side Jenkins/Jira proxies read them directly via
 * `getEngagementConfig()` and use the session's user.engagement to
 * pick the right set.
 */
export async function meEngagementConfigHandler(
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
      await destroySession(session._id);
      clearSessionCookie(res);
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const engagement = user.engagement ?? "espace";
    const cfg = getEngagementConfig(engagement);
    res.json({ config: toPublicEngagementConfig(engagement, cfg) });
  } catch (err) {
    next(err);
  }
}

/**
 * Self-service profile update. Scoped to fields the user is allowed
 * to change about themselves — displayName, employeeId, department.
 * Admin-managed fields (role/status/hubs) flow through
 * /api/v1/admin/users/:id; email changes are deferred (require the
 * confirmation-email + session-invalidation dance).
 *
 * Empty body / no-diff patches return 200 + the unchanged user with
 * no audit row written — matches the admin PATCH endpoint's policy
 * of "don't pollute the log on re-save-on-blur UIs".
 */
export async function updateMeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = profileUpdateSchema.parse(req.body);

    const users = await getUsersCollection();
    const user = await users.findOne({ _id: session.userId });
    if (!user) {
      await destroySession(session._id);
      clearSessionCookie(res);
      throw new HttpError(401, "unauthenticated", "Login required.");
    }

    // Build a minimal $set + a paired before/after for the audit row.
    // Only include keys the caller actually sent AND whose value
    // differs from the stored value.
    const set: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (
      payload.displayName !== undefined &&
      payload.displayName !== user.displayName
    ) {
      set.displayName = payload.displayName;
      before.displayName = user.displayName;
      after.displayName = payload.displayName;
    }
    if (
      payload.employeeId !== undefined &&
      payload.employeeId !== (user.employeeId ?? null)
    ) {
      set.employeeId = payload.employeeId;
      before.employeeId = user.employeeId ?? null;
      after.employeeId = payload.employeeId;
    }
    if (
      payload.department !== undefined &&
      payload.department !== (user.department ?? null)
    ) {
      set.department = payload.department;
      before.department = user.department ?? null;
      after.department = payload.department;
    }
    // C7: prefs are PARTIAL — merge the sent keys over the stored prefs
    // so a `{ aiProvider }` patch doesn't wipe `lastReviewDate`. Only
    // write when the merged result actually differs.
    if (payload.prefs !== undefined) {
      const current = user.prefs ?? {};
      const merged = { ...current, ...payload.prefs };
      if (JSON.stringify(merged) !== JSON.stringify(current)) {
        set.prefs = merged;
        before.prefs = current;
        after.prefs = merged;
      }
    }

    if (Object.keys(set).length === 0) {
      // No-op. Don't touch updatedAt, don't write an audit row.
      res.json({ user: toPublicUser(user) });
      return;
    }

    const now = new Date();
    const updated = await users.findOneAndUpdate(
      { _id: user._id },
      { $set: { ...set, updatedAt: now } },
      { returnDocument: "after" },
    );
    if (!updated) {
      throw new HttpError(
        500,
        "internal_error",
        "Profile update returned no document.",
      );
    }

    await writeAudit({
      orgId: user.orgId,
      actorUserId: user._id,
      actorRole: user.role,
      action: "user.profile_update",
      targetType: "user",
      targetId: user._id.toHexString(),
      before,
      after,
      ...networkMeta(req),
    });

    res.json({ user: toPublicUser(updated) });
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

    const { email, role, roles, displayName } = inviteSchema.parse(req.body);

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
        // M-CAP: write both. `role` is the legacy compat shim
        // (= roles[0]); `roles` is the new source of truth that
        // /hubs/me reads to resolve capabilities.
        role: roles[0],
        roles,
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
        // M10.1: every new invite lands with access to the default hub.
        // Onboarding (M-OB) replaces this with the department-resolved
        // hub when the user submits the form. Admins can override later
        // via M10.5.
        allowedHubs: [DEFAULT_HUB_ID],
        primaryHub: DEFAULT_HUB_ID,
        // M-OB: explicit null so the AuthGuard knows to trap this
        // user at /onboarding on first authenticated load.
        onboardingCompletedAt: null,
        employeeId: null,
        department: null,
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
      after: { email, role, roles, displayName, status: user.status },
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
      roles: effectiveRoles(user),
      ip: meta.ip,
      userAgent: meta.ua,
      totpVerified: true,
      // Fresh invitee — no TOTP enrolment yet. The AuthGuard will
      // trap them at /totp-setup. Server-side enforcement (via
      // requireTotpEnrolled) blocks API access to protected routes
      // until they finish enrolment.
      totpEnrolled: false,
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
    // pending_email users count — they HAVE a password; locking them
    // out of reset would strand them if they forget it before opening
    // the verification link.
    if (
      user &&
      (user.status === "active" || user.status === "pending_email") &&
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
    await revokeTrustedDevices(await getTrustedDevicesCollection(), user._id);

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
          // Drop any leftover re-enrol (move-to-new-phone) secret.
          totpPendingSecret: null,
          totpPendingExpiresAt: null,
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
    const { code, trustDevice } = totpEnrolVerifySchema.parse(req.body);

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

    // Mint the first set of backup codes alongside enrolment. Only the
    // hashes are stored; the plaintext goes back in THIS response and
    // nowhere else.
    const backupCodes = await issueBackupCodes(
      users,
      user._id,
      env.SESSION_SECRET,
      now,
    );

    // Flip the CURRENT session's totpEnrolled flag so the next request
    // passes requireAuth({requireTotpEnrolled: true}) without a user
    // lookup. Other live sessions for the same user (e.g. an old tab)
    // will pass too as soon as they refresh and re-load the session
    // doc, which happens every request.
    if (session._id) {
      await setSessionTotpEnrolled(session._id, true);
    }

    if (trustDevice) {
      await trustThisBrowser(res, user, req, now);
    }

    await writeAudit({
      orgId: user.orgId,
      actorUserId: user._id,
      actorRole: user.role,
      action: "user.totp_enrolled",
      targetType: "user",
      targetId: user._id.toHexString(),
      after: { backupCodesIssued: backupCodes.length },
      ...networkMeta(req),
    });

    res.json({ ok: true, backupCodes });
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
    const input = totpLoginVerifySchema.parse(req.body);

    const users = await getUsersCollection();
    const user = await users.findOne({ _id: session.userId });
    if (!user || user.totpEnrolledAt === null || user.totpSecret === null) {
      // Session somehow points at a user without TOTP. Treat as an
      // auth state error — likely the user was disabled or TOTP was
      // removed admin-side mid-session.
      throw new HttpError(401, "unauthenticated", "Login required.");
    }

    let backupCodesRemaining = countRemainingBackupCodes(user.totpBackupCodes);
    let usedBackupCode = false;

    if (typeof input.backupCode === "string") {
      // Atomic consume — see backup-codes.ts. null = unknown/used/malformed;
      // one generic error so a caller can't tell "used" from "never existed".
      const remaining = await consumeBackupCode(
        users,
        user._id,
        input.backupCode,
        env.SESSION_SECRET,
      );
      if (remaining === null) {
        throw new HttpError(
          401,
          "invalid_backup_code",
          "Backup code did not match or was already used.",
        );
      }
      backupCodesRemaining = remaining;
      usedBackupCode = true;
    } else {
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

      if (!verifyTotpCode(input.code ?? "", plainSecret)) {
        throw new HttpError(401, "invalid_totp_code", "Code did not match.");
      }
    }

    // Stamp a backup-code verify so the lost-phone path can start a
    // move to a new phone right away without spending a second code.
    await setSessionTotpVerified(
      session._id,
      true,
      usedBackupCode ? new Date() : null,
    );

    // Backup codes never earn trust — only a real authenticator code.
    if (!usedBackupCode && "trustDevice" in input && input.trustDevice) {
      await trustThisBrowser(res, user, req, new Date());
    }

    await writeAudit({
      orgId: user.orgId,
      actorUserId: user._id,
      actorRole: user.role,
      action: usedBackupCode ? "auth.backup_code_used" : "auth.totp_verified",
      targetType: "session",
      targetId: session._id,
      ...(usedBackupCode ? { after: { backupCodesRemaining } } : {}),
      ...networkMeta(req),
    });

    res.json({
      user: { ...toPublicUser(user), backupCodesRemaining },
      usedBackupCode,
      backupCodesRemaining,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/totp/backup-codes/regenerate ──────────────────

/**
 * Replace every backup code with a fresh set. Requires a full session
 * AND a current authenticator code — a stolen cookie alone must not be
 * able to mint recovery codes. Old codes (used or not) stop working
 * the moment this returns. The new plaintext is returned once.
 */
export async function backupCodesRegenerateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { code } = backupCodesRegenerateSchema.parse(req.body);

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
        "[totp] decrypt failed during backup-code regenerate",
      );
      throw new HttpError(500, "totp_secret_corrupted", "Internal error.");
    }

    if (!verifyTotpCode(code, plainSecret)) {
      throw new HttpError(401, "invalid_totp_code", "Code did not match.");
    }

    const backupCodes = await issueBackupCodes(
      users,
      user._id,
      env.SESSION_SECRET,
    );

    await writeAudit({
      orgId: user.orgId,
      actorUserId: user._id,
      actorRole: user.role,
      action: "user.backup_codes_regenerated",
      targetType: "user",
      targetId: user._id.toHexString(),
      before: {
        backupCodesRemaining: countRemainingBackupCodes(user.totpBackupCodes),
      },
      after: { backupCodesRemaining: backupCodes.length },
      ...networkMeta(req),
    });

    res.json({ backupCodes, backupCodesRemaining: backupCodes.length });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/totp/re-enrol/{start,confirm} ─────────────────

async function reenrolDeps(): Promise<ReenrolDeps> {
  return {
    store: await getUsersCollection(),
    pepper: env.SESSION_SECRET,
    verifyPassword,
    verifyTotp: verifyTotpCode,
    encrypt: encryptSecret,
    decrypt: decryptSecret,
    generateSecret: generateTotpSecret,
    provisioningUri: buildProvisioningUri,
  };
}

function asHttpError(err: unknown): unknown {
  return err instanceof ReenrolError
    ? new HttpError(err.status, err.code, err.message)
    : err;
}

/**
 * Move two-factor to a new phone, step 1. Full session required, plus
 * the password AND one of: a current authenticator code, an unused
 * backup code (consumed), or — on the lost-phone path — this session
 * having been verified with a backup code in the last 10 minutes.
 * Returns a PENDING secret; the live one keeps working until confirm.
 */
export async function totpReenrolStartHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const input = totpReenrolStartSchema.parse(req.body);
    const result = await startReenrol(await reenrolDeps(), session.userId, input, {
      verifiedWithBackupCodeAt: session.verifiedWithBackupCodeAt ?? null,
    });

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "user.totp_reenrol_started",
      targetType: "user",
      targetId: session.userId.toHexString(),
      after: {
        factor: result.factor,
        backupCodesRemaining: result.backupCodesRemaining,
        pendingExpiresAt: result.expiresAt.toISOString(),
      },
      ...networkMeta(req),
    });

    res.json({
      secret: result.secret,
      otpauthUrl: result.otpauthUrl,
      expiresAt: result.expiresAt.toISOString(),
      backupCodesRemaining: result.backupCodesRemaining,
    });
  } catch (err) {
    next(asHttpError(err));
  }
}

/**
 * Step 2. A code from the NEW app swaps the pending secret in, issues
 * 10 fresh backup codes (old ones stop working) and sends every OTHER
 * session of this user back to the TOTP prompt. This session stays
 * verified.
 */
export async function totpReenrolConfirmHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { code } = totpReenrolConfirmSchema.parse(req.body);
    const result = await confirmReenrol(await reenrolDeps(), session.userId, code);

    // This session proved the new factor just now — clear its
    // backup-code stamp so the shortcut can't be replayed.
    await setSessionTotpVerified(session._id, true, null);
    let otherSessionsReset = 0;
    try {
      otherSessionsReset = await requireTotpReverifyForOtherSessions(
        session.userId,
        session._id,
      );
    } catch (err) {
      logger.warn(
        {
          userId: session.userId.toHexString(),
          err: err instanceof Error ? err.message : String(err),
        },
        "[totp] re-enrol: other-session re-verify flip failed",
      );
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "user.totp_reenrolled",
      targetType: "user",
      targetId: session.userId.toHexString(),
      before: { backupCodesRemaining: result.previousBackupCodesRemaining },
      after: {
        backupCodesRemaining: result.backupCodes.length,
        otherSessionsReset,
      },
      ...networkMeta(req),
    });

    // New authenticator — browsers trusted under the old one re-prove.
    await revokeTrustedDevices(await getTrustedDevicesCollection(), session.userId);

    res.json({ ok: true, backupCodes: result.backupCodes });
  } catch (err) {
    next(asHttpError(err));
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
          ...CLEAR_BACKUP_CODES,
          totpPendingSecret: null,
          totpPendingExpiresAt: null,
          updatedAt: now,
        },
      },
    );

    await revokeTrustedDevices(await getTrustedDevicesCollection(), user._id);

    // Flip the current session's totpEnrolled flag false. Subsequent
    // requests will hit the requireTotpEnrolled gate and bounce to
    // /totp-setup, matching the new-user flow. Other live sessions
    // for the same user keep working until they hit a gated route
    // (the session lookup on each request reads the same Mongo doc).
    if (session._id) {
      await setSessionTotpEnrolled(session._id, false);
    }

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


// ─── POST /api/v1/auth/signup (public) ───────────────────────────────

/**
 * Self-serve signup. Two gates (signup-policy.ts):
 *   - free domain (SIGNUP_FREE_DOMAINS, default espace.com.eg): no
 *     code — the emailed verification link proves ownership;
 *   - any other domain: a live org signup code, as before.
 * Either way the user starts `pending_email` with dev access, gets a
 * verification email, and a session that only reaches me / logout /
 * resend-verification until the link is opened. Then TOTP setup →
 * onboarding → dev hub. No admin approval.
 *
 * Email uniqueness is enforced at the unique index — a duplicate-key
 * race becomes the same generic "email_taken" answer as the pre-check.
 */
export async function signupHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password, displayName, signupCode } =
      signupSchema.parse(req.body);

    const now = new Date();
    const gate = resolveSignupGate({
      email,
      signupCode,
      freeDomains: configuredFreeDomains(),
    });
    const orgs = await getOrgsCollection();
    // Free-domain signups join the deployment's org (single-org, same
    // assumption as the invite flow); everyone else is placed by the
    // org whose live signup code they supplied.
    const org =
      gate.kind === "free"
        ? await orgs.findOne({}, { sort: { createdAt: 1 } })
        : await orgs.findOne({
            signupCodes: {
              $elemMatch: {
                code: gate.code,
                disabledAt: null,
                $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
              },
            },
          });
    if (!org) {
      throw new HttpError(
        400,
        "invalid_signup_code",
        "Signup code is invalid or expired.",
      );
    }

    const users = await getUsersCollection();
    const existing = await users.findOne({ email });
    if (existing) {
      throw new HttpError(
        400,
        "email_taken",
        "An account with this email already exists. Try logging in.",
      );
    }

    const passwordHash = await hashPassword(password);
    const userDoc = newSelfSignupUser({
      orgId: org._id,
      email,
      passwordHash,
      displayName,
      now,
    }) as User;

    let insertedId: ObjectId;
    try {
      const result = await users.insertOne(userDoc);
      insertedId = result.insertedId;
    } catch (err) {
      // Race: another signup landed the same email first. Same generic
      // answer as the pre-check so timing reveals nothing.
      if (err && typeof err === "object" && "code" in err && err.code === 11000) {
        throw new HttpError(
          400,
          "email_taken",
          "An account with this email already exists.",
        );
      }
      throw err;
    }

    if (gate.kind === "code") {
      // Bump the code's usedCount so admins see traction on each code.
      await orgs.updateOne(
        { _id: org._id, "signupCodes.code": gate.code },
        { $inc: { "signupCodes.$.usedCount": 1 }, $set: { updatedAt: now } },
      );
    }

    // Session: nothing to TOTP-verify yet (totpEnrolled=false trips
    // /totp-setup later); emailVerified=false keeps every route except
    // me / logout / resend-verification closed until the link is opened.
    const meta = networkMeta(req);
    const { sessionId } = await mintSession({
      userId: insertedId,
      orgId: org._id,
      role: userDoc.role,
      roles: effectiveRoles(userDoc),
      ip: meta.ip,
      userAgent: meta.ua,
      totpVerified: true,
      totpEnrolled: false,
      emailVerified: false,
    });
    setSessionCookie(res, sessionId);

    const sent = await sendVerificationEmail(
      {
        mintToken,
        send: (m) => emailService.send(m),
        appUrl: appOrigin(),
        orgName: org.name,
      },
      { _id: insertedId, orgId: org._id, email, displayName },
      meta,
    );
    if (!sent.ok) {
      logger.warn(
        { email, reason: sent.reason },
        "[auth.signup] verification email failed — user can resend from the inbox screen",
      );
    }

    await writeAudit({
      orgId: org._id,
      actorUserId: insertedId,
      actorRole: userDoc.role,
      action: "user.signup",
      targetType: "user",
      targetId: insertedId.toHexString(),
      after: {
        email,
        freeDomain: gate.kind === "free",
        ...(gate.kind === "code" ? { signupCodeUsed: gate.code } : {}),
        verificationEmailSent: sent.ok,
      },
      ...meta,
    });

    res.json({
      user: toPublicUser({ ...userDoc, _id: insertedId }),
    });
  } catch (err) {
    next(err);
  }
}

// ─── trusted browsers ────────────────────────────────────────────────

async function trustThisBrowser(
  res: Response,
  user: User,
  req: Request,
  now: Date,
): Promise<void> {
  const meta = networkMeta(req);
  const token = await issueTrustedDevice(await getTrustedDevicesCollection(), {
    orgId: user.orgId,
    userId: user._id,
    ip: meta.ip,
    userAgent: meta.ua,
    now,
  });
  setTrustedCookie(res, token);
}

/** GET /auth/trusted-devices — how many browsers skip the TOTP prompt. */
export async function trustedDevicesCountHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const count = await countTrustedDevices(
      await getTrustedDevicesCollection(),
      req.session!.userId,
      new Date(),
    );
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

/** DELETE /auth/trusted-devices — forget every trusted browser. */
export async function trustedDevicesForgetHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session!;
    const removed = await revokeTrustedDevices(
      await getTrustedDevicesCollection(),
      session.userId,
    );
    clearTrustedCookie(res);
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "auth.trusted_devices_forgotten",
      targetType: "user",
      targetId: session.userId.toHexString(),
      after: { removed },
      ...networkMeta(req),
    });
    res.json({ ok: true, removed });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/verify-email (public) ─────────────────────────

/**
 * Redeem the emailed verification link. Public: the link is often
 * opened on another device than the one that signed up. Activates the
 * user and unblocks all of their sessions (see email-verification.ts).
 */
export async function verifyEmailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = verifyEmailSchema.parse(req.body);
    const users = await getUsersCollection();
    const sessions = await getSessionsCollection();
    const result = await verifyEmail(
      {
        redeem: (t) => redeemToken(t, "email_verify"),
        findAny: (t) => findTokenAnyState(t, "email_verify"),
        users,
        sessions,
        now: () => new Date(),
      },
      token,
    );
    if (result.status === "verified") {
      await writeAudit({
        orgId: result.user.orgId,
        actorUserId: result.user._id,
        actorRole: result.user.role,
        action: "user.email_verified",
        targetType: "user",
        targetId: result.user._id.toHexString(),
        after: { email: result.user.email },
        ...networkMeta(req),
      });
    }
    res.json({ status: result.status, user: toPublicUser(result.user) });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/auth/resend-verification ───────────────────────────

/** Send a fresh verification link to the signed-in, unverified user. */
export async function resendVerificationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session!;
    const users = await getUsersCollection();
    const user = await users.findOne({ _id: session.userId });
    if (!user || user.status !== "pending_email") {
      throw new HttpError(409, "already_verified", "This email is already verified.");
    }
    const org = await (await getOrgsCollection()).findOne({ _id: user.orgId });
    const sent = await sendVerificationEmail(
      {
        mintToken,
        send: (m) => emailService.send(m),
        appUrl: appOrigin(),
        orgName: org?.name ?? "eSpace",
      },
      user,
      networkMeta(req),
    );
    if (!sent.ok) {
      logger.warn(
        { email: user.email, reason: sent.reason },
        "[auth.resend-verification] email send failed",
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ─── Phase 3: companion-tunnel registration + api-origin lookup ──────

const COMPANION_STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns true if the user's companionTunnel registration is fresh
 * enough to route real traffic to. A stale registration (no heartbeat
 * in >5 min) is treated as "companion offline"; the caller falls back
 * to the bundled API or surfaces an "open companion" banner.
 */
function isCompanionFresh(t: {
  hostname: string;
  registeredAt: Date;
  lastSeenAt: Date;
} | null | undefined): boolean {
  if (!t || !t.hostname) return false;
  const ageMs = Date.now() - new Date(t.lastSeenAt).getTime();
  return ageMs < COMPANION_STALE_AFTER_MS;
}

// ─── POST /api/v1/me/companion-tunnel ─────────────────────────────────
//
// Called by the desktop companion app once its tunnel + Docker stack
// are up. Registers (or refreshes) the user's tunnel hostname.
// Authenticated via the regular session cookie (the companion will
// have one after the Phase 3c device-pairing flow lands; in Phase 3a
// the user can call this from a logged-in browser tab to seed it).
//
// Audit: writes user.companion_tunnel_registered. Lets admins see
// when a Crealogix dev brought their backend online without exposing
// the hostname publicly.

export async function companionTunnelRegisterHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Accept EITHER a browser session OR a companion bearer token.
    // Phase 3a seeded this from a logged-in browser tab; Phase 3c +
    // onward the companion app calls it directly with its paired token.
    const principal = await resolveCompanionPrincipal(req);
    if (!principal) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { hostname } = companionTunnelRegisterSchema.parse(req.body);
    const users = await getUsersCollection();
    const now = new Date();

    // Read current state so we can write an honest before/after audit.
    const existing = await users.findOne({ _id: principal.userId });
    if (!existing) {
      throw new HttpError(404, "not_found", "User not found.");
    }
    const before = existing.companionTunnel ?? null;

    const next_value = {
      hostname,
      // Preserve original registeredAt across heartbeats so admins
      // can see "this user first brought their companion online at X."
      registeredAt: before?.hostname === hostname ? before.registeredAt : now,
      lastSeenAt: now,
    };

    await users.updateOne(
      { _id: principal.userId },
      {
        $set: { companionTunnel: next_value, updatedAt: now },
      },
    );

    await writeAudit({
      orgId: principal.orgId,
      actorUserId: principal.userId,
      actorRole: principal.role,
      action: "user.companion_tunnel_registered",
      targetType: "user",
      targetId: principal.userId.toHexString(),
      before: before ? { hostname: before.hostname } : null,
      after: { hostname, via: principal.source },
      ...networkMeta(req),
    });

    res.json({
      companionTunnel: {
        hostname,
        registeredAt: next_value.registeredAt.toISOString(),
        lastSeenAt: next_value.lastSeenAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/me/companion-tunnel ────────────────────────────────
//
// Called by the companion when the user clicks Stop backend / Quit.
// Cleanly removes the registration so the catch-all stops routing to
// a dead tunnel and falls back to the bundled API.

export async function companionTunnelClearHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const principal = await resolveCompanionPrincipal(req);
    if (!principal) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const users = await getUsersCollection();
    const now = new Date();
    const before = await users.findOne({ _id: principal.userId });

    await users.updateOne(
      { _id: principal.userId },
      { $set: { companionTunnel: null, updatedAt: now } },
    );

    if (before?.companionTunnel) {
      await writeAudit({
        orgId: principal.orgId,
        actorUserId: principal.userId,
        actorRole: principal.role,
        action: "user.companion_tunnel_cleared",
        targetType: "user",
        targetId: principal.userId.toHexString(),
        before: { hostname: before.companionTunnel.hostname },
        after: { via: principal.source },
        ...networkMeta(req),
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/me/api-origin ────────────────────────────────────────
//
// Frontend calls this on login to decide which origin to route
// /api/v1/* calls to. Returns:
//   { origin: "<companion-hostname>", source: "companion" }    when fresh
//   { origin: null, source: "bundled" }                        otherwise
//
// The frontend's apiFetch wrapper uses `source: "companion"` as the
// signal to set the `X-Companion-Origin` header on subsequent calls
// so the catch-all knows to proxy. (The catch-all also re-verifies
// the origin server-side — it doesn't trust the header alone.)

export async function meApiOriginHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Mostly called by the browser, but the companion can also poll it
    // to verify it's the active registration.
    const principal = await resolveCompanionPrincipal(req);
    if (!principal) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const users = await getUsersCollection();
    const user = await users.findOne({ _id: principal.userId });
    if (!user) {
      throw new HttpError(404, "not_found", "User not found.");
    }

    if (isCompanionFresh(user.companionTunnel)) {
      res.json({
        origin: `https://${user.companionTunnel!.hostname}`,
        source: "companion",
        lastSeenAt: user.companionTunnel!.lastSeenAt.toISOString(),
      });
      return;
    }

    res.json({
      origin: null,
      source: "bundled",
      // Hint to the frontend about why we fell back so the UI can
      // show a useful banner (e.g. "Companion last seen 2h ago —
      // open it to resume").
      lastSeenAt: user.companionTunnel?.lastSeenAt?.toISOString() ?? null,
      staleHostname: user.companionTunnel?.hostname ?? null,
    });
  } catch (err) {
    next(err);
  }
}
