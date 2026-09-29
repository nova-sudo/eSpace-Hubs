/**
 * Admin roster reads + the reporting-line tools (hub-audit §1.4, §2.3,
 * §2.4). Everything is scoped to `session.orgId`.
 *
 *   GET  /admin/users                      paginated, server-side search
 *                                          + filters (§2.3)
 *   GET  /admin/users/summary              the counts the overview shows
 *   GET  /admin/users/directory            lightweight id/name/email/roles
 *                                          list for pickers + name lookups
 *   GET  /admin/org-chart                  the reporting tree + its flags
 *   POST /admin/users/:id/reassign-reports move every report of :id to
 *                                          another manager (lib/reassign-reports)
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId, type Filter } from "mongodb";
import { getUsersCollection } from "../../db/collections.js";
import type { User } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { createNotification } from "../../lib/notifications.js";
import { reassignReports } from "../../lib/reassign-reports.js";
import { effectiveRoles } from "../../lib/user-roles.js";
import { HttpError } from "../../middleware/error-handler.js";
import { toPublicUser } from "./controller.js";
import { buildOrgChart, type RosterUser } from "./org-chart.js";
import { listUsersQuerySchema, reassignReportsSchema } from "./schemas.js";

/** Hard ceiling for the whole-org projections (directory, org chart). */
const DIRECTORY_CAP = 5_000;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keyset cursor over (createdAt desc, _id desc): "<ISO>_<hex>". */
function encodeCursor(u: Pick<User, "createdAt" | "_id">): string {
  return `${u.createdAt.toISOString()}_${u._id.toHexString()}`;
}

function decodeCursor(raw: string): { at: Date; id: ObjectId } {
  const sep = raw.lastIndexOf("_");
  const at = new Date(raw.slice(0, sep));
  const hex = raw.slice(sep + 1);
  if (sep < 0 || Number.isNaN(at.getTime()) || !/^[0-9a-f]{24}$/i.test(hex)) {
    throw new HttpError(400, "validation_error", "Invalid cursor.");
  }
  return { at, id: new ObjectId(hex) };
}

/** The whole org as lightweight roster rows. */
async function loadRoster(orgId: ObjectId): Promise<RosterUser[]> {
  const col = await getUsersCollection();
  const rows = await col
    .find(
      { orgId },
      {
        projection: {
          displayName: 1,
          email: 1,
          status: 1,
          role: 1,
          roles: 1,
          managerId: 1,
        },
      },
    )
    .sort({ displayName: 1, _id: 1 })
    .limit(DIRECTORY_CAP)
    .toArray();
  return rows.map((u) => ({
    id: u._id.toHexString(),
    displayName: u.displayName,
    email: u.email,
    status: u.status,
    roles: effectiveRoles(u),
    managerId: u.managerId ? u.managerId.toHexString() : null,
  }));
}

/** Mongo clause: holds dev or qa (the people who need an approver). */
const NEEDS_MANAGER_CLAUSE: Filter<User> = {
  $or: [{ roles: { $in: ["dev", "qa"] } }, { role: { $in: ["dev", "qa"] } }],
};

// ─── GET /admin/users ────────────────────────────────────────────────

/**
 * Query: ?limit=1..200 (50) &cursor= &q= (name/email substring)
 *        &status=all|active|invited|pending_admin|disabled
 *        &flag=no_manager|disabled_manager &managerId=<hex>
 *
 * → { users: PublicUser[] (+ managerName / managerStatus),
 *     hasMore, nextCursor, counts: { all, active, invited, pending_admin,
 *     disabled } }  — counts honour q/flag/managerId but not status, so
 *     the status pills can show what each would return.
 */
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
    const q = listUsersQuerySchema.parse(req.query);
    const col = await getUsersCollection();

    const and: Filter<User>[] = [{ orgId: session.orgId }];
    if (q.q) {
      const re = new RegExp(escapeRegex(q.q), "i");
      and.push({ $or: [{ displayName: re }, { email: re }] });
    }
    if (q.managerId) and.push({ managerId: new ObjectId(q.managerId) });
    if (q.flag === "no_manager") {
      and.push(
        { status: { $ne: "disabled" } },
        { $or: [{ managerId: null }, { managerId: { $exists: false } }] },
        NEEDS_MANAGER_CLAUSE,
      );
    } else if (q.flag === "disabled_manager") {
      const disabled = await col
        .find(
          { orgId: session.orgId, status: "disabled" },
          { projection: { _id: 1 } },
        )
        .toArray();
      and.push(
        { status: { $ne: "disabled" } },
        { managerId: { $in: disabled.map((d) => d._id) } },
      );
    }
    const base: Filter<User> = { $and: and };

    const pageFilter: Filter<User> = { $and: [...and] };
    if (q.status !== "all") {
      (pageFilter.$and as Filter<User>[]).push({ status: q.status as User["status"] });
    }
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      (pageFilter.$and as Filter<User>[]).push({
        $or: [
          { createdAt: { $lt: c.at } },
          { createdAt: c.at, _id: { $lt: c.id } },
        ],
      });
    }

    const [rows, grouped] = await Promise.all([
      col
        .find(pageFilter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(q.limit + 1)
        .toArray(),
      col
        .aggregate<{ _id: string; n: number }>([
          { $match: base },
          { $group: { _id: "$status", n: { $sum: 1 } } },
        ])
        .toArray(),
    ]);
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;

    // Manager names for this page only — one $in lookup.
    const managerIds = [
      ...new Set(page.map((u) => u.managerId?.toHexString()).filter(Boolean)),
    ].map((h) => new ObjectId(h as string));
    const managers = managerIds.length
      ? await col
          .find(
            { orgId: session.orgId, _id: { $in: managerIds } },
            { projection: { displayName: 1, email: 1, status: 1 } },
          )
          .toArray()
      : [];
    const byId = new Map(managers.map((m) => [m._id.toHexString(), m]));

    const counts: Record<string, number> = {
      all: 0,
      active: 0,
      invited: 0,
      pending_admin: 0,
      disabled: 0,
    };
    for (const g of grouped) {
      counts[g._id] = g.n;
      counts.all += g.n;
    }

    const last = page[page.length - 1];
    res.json({
      users: page.map((u) => {
        const m = u.managerId ? byId.get(u.managerId.toHexString()) : undefined;
        return {
          ...toPublicUser(u),
          managerName: m ? m.displayName || m.email : null,
          managerStatus: u.managerId ? (m?.status ?? "missing") : null,
        };
      }),
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      counts,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /admin/users/summary ────────────────────────────────────────

/**
 * → { total, byStatus, noTotp, noManager, disabledManagerReports,
 *     managerWithoutRole, cycles, pending: [{id, displayName, email,
 *     createdAt}] (oldest first, ≤ 20) }
 */
export async function usersSummaryHandler(
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
    const [roster, grouped, noTotp, pending] = await Promise.all([
      loadRoster(session.orgId),
      col
        .aggregate<{ _id: string; n: number }>([
          { $match: { orgId: session.orgId } },
          { $group: { _id: "$status", n: { $sum: 1 } } },
        ])
        .toArray(),
      col.countDocuments({
        orgId: session.orgId,
        status: { $ne: "disabled" },
        totpSecret: null,
      }),
      col
        .find(
          { orgId: session.orgId, status: "pending_admin" },
          { projection: { displayName: 1, email: 1, createdAt: 1 } },
        )
        .sort({ createdAt: 1 })
        .limit(20)
        .toArray(),
    ]);
    const chart = buildOrgChart(roster);
    const byStatus: Record<string, number> = {
      active: 0,
      invited: 0,
      pending_admin: 0,
      disabled: 0,
    };
    let total = 0;
    for (const g of grouped) {
      byStatus[g._id] = g.n;
      total += g.n;
    }
    res.json({
      total,
      byStatus,
      noTotp,
      noManager: chart.stats.noManager,
      disabledManagerReports: chart.stats.disabledManagerReports,
      managerWithoutRole: chart.stats.managerWithoutRole,
      cycles: chart.stats.cycles,
      pending: pending.map((u) => ({
        id: u._id.toHexString(),
        displayName: u.displayName,
        email: u.email,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /admin/users/directory ──────────────────────────────────────

/** → { users: [{ id, displayName, email, status, roles, managerId }] } */
export async function directoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    res.json({ users: await loadRoster(session.orgId) });
  } catch (err) {
    next(err);
  }
}

// ─── GET /admin/org-chart ────────────────────────────────────────────

/**
 * → { nodes: [{ id, displayName, email, status, roles, managerId,
 *     reportIds, flags }], rootIds, cycles, stats }
 * flags ⊂ no_manager | manager_disabled | manager_missing |
 *         manager_not_manager | in_cycle
 */
export async function orgChartHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    res.json(buildOrgChart(await loadRoster(session.orgId)));
  } catch (err) {
    next(err);
  }
}

// ─── POST /admin/users/:id/reassign-reports ──────────────────────────

/**
 * Body: { toManagerId: hex | null }  (null = leave them with no manager)
 * → { moved, skipped, pendingApprovals, toManagerName }
 *
 * Moves every report of :id (the "from" manager). Validation — the new
 * manager is active, in the org, holds the manager capability, and no
 * loop is created — lives in lib/reassign-reports; reports that would
 * loop are skipped and listed, never silently. Audited as
 * `admin.user.reassign_reports`; each moved (non-disabled) report is notified.
 */
export async function reassignReportsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { id } = req.params as { id?: string };
    if (typeof id !== "string" || !/^[0-9a-f]{24}$/i.test(id)) {
      throw new HttpError(400, "validation_error", "User id must be a 24-char hex ObjectId.");
    }
    const fromManagerId = new ObjectId(id);
    const body = reassignReportsSchema.parse(req.body ?? {});
    const toManagerId = body.toManagerId ? new ObjectId(body.toManagerId) : null;

    const col = await getUsersCollection();
    const from = await col.findOne(
      { _id: fromManagerId, orgId: session.orgId },
      { projection: { displayName: 1, email: 1 } },
    );
    if (!from) {
      throw new HttpError(404, "not_found", "User not found in this org.");
    }

    const result = await reassignReports({
      orgId: session.orgId,
      fromManagerId,
      toManagerId,
      actorUserId: session.userId,
    });

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "admin.user.reassign_reports",
      targetType: "user",
      targetId: fromManagerId.toHexString(),
      before: result.audit.before,
      after: { ...result.audit.after, skipped: result.skipped },
      ...networkMeta(req),
    });

    const fromName = from.displayName || from.email;
    if (result.reassigned.length > 0) {
      const moved = await col
        .find(
          {
            orgId: session.orgId,
            _id: { $in: result.reassigned.map((h) => new ObjectId(h)) },
            status: { $ne: "disabled" },
          },
          { projection: { _id: 1 } },
        )
        .toArray();
      for (const r of moved) {
        void createNotification({
          orgId: session.orgId,
          userId: r._id,
          kind: "manager_changed",
          title: result.toManagerName
            ? `You now report to ${result.toManagerName}`
            : "You no longer have a manager assigned",
          body: result.toManagerName
            ? `An admin moved ${fromName}'s team to ${result.toManagerName}. Pending approvals went with you.`
            : `An admin removed ${fromName} as your manager. Until a new one is assigned, your goal approvals go to the org's admins.`,
          data: {
            fromManagerId: fromManagerId.toHexString(),
            toManagerId: toManagerId?.toHexString() ?? null,
          },
          createdBy: session.userId,
        });
      }
      if (toManagerId) {
        void createNotification({
          orgId: session.orgId,
          userId: toManagerId,
          kind: "manager_changed",
          title: `${result.reassigned.length} ${result.reassigned.length === 1 ? "person now reports" : "people now report"} to you`,
          body: `An admin moved ${fromName}'s reports to you.`,
          data: { fromManagerId: fromManagerId.toHexString(), count: result.reassigned.length },
          createdBy: session.userId,
        });
      }
    }

    res.json({
      moved: result.reassigned.length,
      reassigned: result.reassigned,
      skipped: result.skipped,
      pendingApprovals: result.pendingApprovals,
      toManagerName: result.toManagerName,
    });
  } catch (err) {
    next(err);
  }
}
