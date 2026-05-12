/**
 * Admin controller — org-wide read/edit over the user roster + audit log.
 *
 *   GET    /api/v1/admin/users         list every member of the org
 *   PATCH  /api/v1/admin/users/:id     edit roles / status / hub access /
 *                                       displayName for one user
 *   GET    /api/v1/admin/audit         filterable audit-log feed
 *
 * Authorization: every route is gated by `requireRole("admin")` in
 * routes.ts. The controller assumes that gate has passed and only
 * applies the cross-org boundary (every query is `orgId =
 * session.orgId` — an admin in org A can never see org B).
 *
 * Public shape: PublicUser explicitly DROPS passwordHash, totpSecret,
 * and totpEnrolledAt. Those fields exist for the controller to query
 * (e.g. for "has set a password" / "has enrolled TOTP" booleans) but
 * the bytes never leave the process.
 *
 * Audit: every mutation writes a row with `before` and `after`
 * trimmed to just the admin-editable fields. We deliberately skip
 * audit on no-op patches (empty body or no diff vs. current state)
 * so the log doesn't fill with noise from a UI that re-saves on
 * every blur.
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { findHubById, HUB_ORDER } from "@espace-devhub/shared/hubs";
import {
  getAuditLogCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type { AuditLogEntry, User, UserRole } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { effectiveRoles } from "../../lib/user-roles.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  listAuditQuerySchema,
  updateUserSchema,
} from "./schemas.js";

// ─── public shapes ───────────────────────────────────────────────────

/**
 * What an admin client sees per user. Drops secrets (passwordHash,
 * totpSecret) but keeps the BOOLEAN derived from them so the UI can
 * render "TOTP enrolled? Y/N" + "has password? Y/N" without ever
 * touching the bytes.
 */
interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  roles: UserRole[];
  status: string;
  allowedHubs: string[];
  primaryHub: string | null;
  department: string | null;
  employeeId: string | null;
  level: string | null;
  hasPassword: boolean;
  hasTotp: boolean;
  totpEnrolledAt: string | null;
  invitedAt: string | null;
  invitedBy: string | null;
  lastLoginAt: string | null;
  onboardingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toPublicUser(u: User): PublicUser {
  return {
    id: u._id.toHexString(),
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    roles: effectiveRoles(u),
    status: u.status,
    allowedHubs: u.allowedHubs ?? [],
    primaryHub: u.primaryHub ?? null,
    department: u.department ?? null,
    employeeId: u.employeeId ?? null,
    level: u.level ?? null,
    hasPassword: u.passwordHash !== null,
    hasTotp: u.totpSecret !== null,
    totpEnrolledAt: u.totpEnrolledAt ? u.totpEnrolledAt.toISOString() : null,
    invitedAt: u.invitedAt ? u.invitedAt.toISOString() : null,
    invitedBy: u.invitedBy ? u.invitedBy.toHexString() : null,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    onboardingCompletedAt: u.onboardingCompletedAt
      ? u.onboardingCompletedAt.toISOString()
      : null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

interface PublicAuditEntry {
  id: string;
  orgId: string;
  actorUserId: string | null;
  actorRole: UserRole | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  ua: string | null;
  ts: string;
}

function toPublicAudit(row: AuditLogEntry): PublicAuditEntry {
  return {
    id: row._id.toHexString(),
    orgId: row.orgId.toHexString(),
    actorUserId: row.actorUserId ? row.actorUserId.toHexString() : null,
    actorRole: row.actorRole,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    before: row.before,
    after: row.after,
    ip: row.ip,
    ua: row.ua,
    ts: row.ts.toISOString(),
  };
}

// ─── shared helpers ──────────────────────────────────────────────────

function requireUserId(req: Request): ObjectId {
  const { id } = req.params as { id?: string };
  if (typeof id !== "string" || !/^[0-9a-f]{24}$/i.test(id)) {
    throw new HttpError(
      400,
      "validation_error",
      "User id must be a 24-char hex ObjectId.",
    );
  }
  return new ObjectId(id);
}

/**
 * Sanity guards on the patch payload. Throws an HttpError on any
 * invariant violation. Run AFTER the Zod schema parse and AFTER
 * loading the target user — some checks need both inputs.
 */
function validatePatch(input: {
  patch: ReturnType<typeof updateUserSchema.parse>;
  target: User;
  actorUserId: ObjectId;
}): void {
  const { patch, target, actorUserId } = input;

  // Hubs must exist in the shared registry.
  if (Array.isArray(patch.allowedHubs)) {
    for (const id of patch.allowedHubs) {
      if (!findHubById(id)) {
        throw new HttpError(
          400,
          "unknown_hub",
          `Hub "${id}" is not registered. Known hubs: ${HUB_ORDER.join(", ")}.`,
        );
      }
    }
    // Empty is "lock out of every hub" — almost certainly a mistake.
    if (patch.allowedHubs.length === 0) {
      throw new HttpError(
        400,
        "validation_error",
        "allowedHubs cannot be empty — a user needs at least one hub.",
      );
    }
  }

  // primaryHub must exist if explicitly set (non-null).
  if (typeof patch.primaryHub === "string") {
    if (!findHubById(patch.primaryHub)) {
      throw new HttpError(
        400,
        "unknown_hub",
        `Hub "${patch.primaryHub}" is not registered.`,
      );
    }
    // Cross-field: must be a member of the effective allowedHubs.
    const effectiveAllowed =
      patch.allowedHubs ?? target.allowedHubs ?? [];
    if (effectiveAllowed.length > 0 && !effectiveAllowed.includes(patch.primaryHub)) {
      throw new HttpError(
        400,
        "validation_error",
        `primaryHub "${patch.primaryHub}" must appear in allowedHubs.`,
      );
    }
  }

  // Self-lockout prevention. An admin editing their own row cannot:
  //   - remove the "admin" role
  //   - flip status to disabled
  if (target._id.equals(actorUserId)) {
    if (Array.isArray(patch.roles) && !patch.roles.includes("admin")) {
      throw new HttpError(
        400,
        "self_lockout",
        "You can't remove your own admin role. Have another admin do it.",
      );
    }
    if (patch.status === "disabled") {
      throw new HttpError(
        400,
        "self_lockout",
        "You can't disable your own account. Have another admin do it.",
      );
    }
  }
}

/**
 * Build the $set patch + the before/after diff for the audit row.
 * Returns null on a no-op (no field actually changes vs. current state).
 *
 * Fields are compared with strict-ish equality:
 *   - scalars: ===
 *   - arrays:  same length AND same elements in order (we don't
 *              re-sort; the UI sends roles/hubs in the order it
 *              wants to persist)
 */
function diffPatch(input: {
  patch: ReturnType<typeof updateUserSchema.parse>;
  target: User;
}): {
  set: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} | null {
  const { patch, target } = input;
  const set: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  function recordIfChanged<K extends string>(
    key: K,
    nextVal: unknown,
    currentVal: unknown,
  ): void {
    if (arraysOrEqual(nextVal, currentVal)) return;
    set[key] = nextVal;
    before[key] = currentVal;
    after[key] = nextVal;
  }

  if (patch.roles !== undefined) {
    recordIfChanged("roles", patch.roles, effectiveRoles(target));
    // Keep `role` (primary) in lockstep — first element of `roles`.
    // Backward-compat shim until the singular column is removed.
    if (set.roles && Array.isArray(patch.roles)) {
      set.role = patch.roles[0];
    }
  }
  if (patch.status !== undefined) {
    recordIfChanged("status", patch.status, target.status);
  }
  if (patch.allowedHubs !== undefined) {
    recordIfChanged(
      "allowedHubs",
      patch.allowedHubs,
      target.allowedHubs ?? [],
    );
  }
  if (patch.primaryHub !== undefined) {
    recordIfChanged("primaryHub", patch.primaryHub, target.primaryHub ?? null);
  }
  if (patch.displayName !== undefined) {
    recordIfChanged("displayName", patch.displayName, target.displayName);
  }

  if (Object.keys(set).length === 0) return null;
  return { set, before, after };
}

function arraysOrEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return a === b;
}

// ─── GET /api/v1/admin/users ─────────────────────────────────────────

export async function listUsersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const col = await getUsersCollection();
    const rows = await col
      .find({ orgId: session.orgId })
      // Newest first by creation, but stable secondary on _id to make
      // pagination deterministic if the UI ever adds it.
      .sort({ createdAt: -1, _id: -1 })
      .toArray();
    res.json({ users: rows.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/v1/admin/users/:id ───────────────────────────────────

export async function updateUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const targetId = requireUserId(req);
    const patch = updateUserSchema.parse(req.body);

    const col = await getUsersCollection();
    const target = await col.findOne({
      _id: targetId,
      orgId: session.orgId,
    });
    if (!target) {
      throw new HttpError(404, "not_found", "User not found in this org.");
    }

    validatePatch({ patch, target, actorUserId: session.userId });

    const diff = diffPatch({ patch, target });
    if (!diff) {
      // No-op patch — return current public shape WITHOUT touching
      // updatedAt or writing an audit row. Lets the UI re-save freely.
      res.json({ user: toPublicUser(target) });
      return;
    }

    const now = new Date();
    const updated = await col.findOneAndUpdate(
      { _id: targetId, orgId: session.orgId },
      { $set: { ...diff.set, updatedAt: now } },
      { returnDocument: "after" },
    );
    if (!updated) {
      throw new HttpError(
        500,
        "internal_error",
        "User update returned no document.",
      );
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "user.update",
      targetType: "user",
      targetId: targetId.toHexString(),
      before: diff.before,
      after: diff.after,
      ...networkMeta(req),
    });

    res.json({ user: toPublicUser(updated) });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/admin/users/:id/totp/reset ─────────────────────────

/**
 * Admin-side TOTP reset. Clears the target user's totpSecret and
 * totpEnrolledAt so they re-enrol on next login (the AuthGuard's
 * client-side gate traps them at /totp-setup until they re-enrol;
 * post-#2 the server will also enforce this).
 *
 * Use case: a user lost their phone / authenticator app and can no
 * longer pass the second factor. They contact an admin, who confirms
 * identity out-of-band (in person, video call, etc.) and runs this
 * reset. The next login skips the TOTP step (because totpEnrolledAt
 * is now null) — they go straight into the enrol flow.
 *
 * Self-protection: an admin cannot reset their OWN TOTP via this
 * endpoint. If they need to, they call /auth/totp/disable (which
 * requires a current code) or have ANOTHER admin do it. This
 * prevents a hijacked admin session from neutering its own 2FA on
 * the spot — the attacker would need a second compromised admin.
 *
 * No body required. The :id path param identifies the target user.
 *
 * Audit: writes `user.totp_reset_by_admin` with before/after = the
 * old totpEnrolledAt timestamp (null after).
 */
export async function resetUserTotpHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const targetId = requireUserId(req);

    if (targetId.equals(session.userId)) {
      throw new HttpError(
        400,
        "self_lockout",
        "You can't reset your own TOTP via the admin endpoint. Use /auth/totp/disable (requires a current code), or have another admin do it.",
      );
    }

    const col = await getUsersCollection();
    const target = await col.findOne({
      _id: targetId,
      orgId: session.orgId,
    });
    if (!target) {
      throw new HttpError(404, "not_found", "User not found in this org.");
    }

    // If the user has nothing to reset, return 200 anyway — the admin's
    // intent is "make sure TOTP is off for this user" and that's
    // already the case. Idempotent.
    if (target.totpSecret === null && target.totpEnrolledAt === null) {
      res.json({ user: toPublicUser(target), reset: false });
      return;
    }

    const now = new Date();
    const updated = await col.findOneAndUpdate(
      { _id: targetId, orgId: session.orgId },
      {
        $set: {
          totpSecret: null,
          totpEnrolledAt: null,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      throw new HttpError(
        500,
        "internal_error",
        "TOTP reset returned no document.",
      );
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "user.totp_reset_by_admin",
      targetType: "user",
      targetId: targetId.toHexString(),
      before: {
        totpEnrolledAt: target.totpEnrolledAt
          ? target.totpEnrolledAt.toISOString()
          : null,
      },
      after: { totpEnrolledAt: null },
      ...networkMeta(req),
    });

    res.json({ user: toPublicUser(updated), reset: true });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/admin/audit ─────────────────────────────────────────

export async function listAuditHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const q = listAuditQuerySchema.parse(req.query);

    const filter: Record<string, unknown> = { orgId: session.orgId };
    if (q.action) filter.action = q.action;
    if (q.actorUserId) filter.actorUserId = new ObjectId(q.actorUserId);
    if (q.targetType) filter.targetType = q.targetType;
    if (q.targetId) filter.targetId = q.targetId;
    if (q.since || q.until) {
      const tsRange: Record<string, Date> = {};
      if (q.since) tsRange.$gte = new Date(q.since);
      if (q.until) tsRange.$lt = new Date(q.until);
      filter.ts = tsRange;
    }

    // Fetch one extra so we can tell the caller whether more pages
    // exist without an extra count() round-trip.
    const col = await getAuditLogCollection();
    const rows = await col
      .find(filter)
      .sort({ ts: -1, _id: -1 })
      .limit(q.limit + 1)
      .toArray();

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    res.json({
      entries: page.map(toPublicAudit),
      hasMore,
      // Convenience for the client: the next page's `until` value is
      // the oldest row's ts on this page. Saves the client a fencepost.
      nextUntil:
        hasMore && page.length > 0
          ? page[page.length - 1]?.ts.toISOString() ?? null
          : null,
    });
  } catch (err) {
    next(err);
  }
}
