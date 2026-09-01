/**
 * Goals controller — GET + PUT for the user's L1/L2 tree.
 *
 * One tree per (orgId, userId), whole-tree replace semantics. The
 * unique index only prevents a second DOCUMENT — it can't guard two
 * updates racing on the same one — so PUT takes an optimistic
 * concurrency token: the client echoes the `updatedAt` it last saw and
 * a mismatch 409s with the CURRENT tree (one round trip to resync)
 * instead of a stale tab silently deleting another device's goals.
 *
 * GET is auto-creating: if no tree exists, return an empty tree
 * shape rather than 404. Matches the existing `readGoals()` contract
 * on the frontend (always returns a `{schemaVersion, l1s: []}` shell).
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  getGoalCyclesCollection,
  getGoalTierVerdictsCollection,
  getGoalsCollection,
  getManagerGoalVerdictsCollection,
} from "../../db/collections.js";
import {
  GOALS_SCHEMA_VERSION,
  WHOLE_GOAL_TIER_KEY,
  type GoalCycleReportRow,
  type GoalL1,
  type GoalTree,
} from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";
import { goalsUpsertSchema } from "./schemas.js";

interface PublicGoalTree {
  schemaVersion: typeof GOALS_SCHEMA_VERSION;
  l1s: GoalL1[];
  cycleId: string | null;
  updatedAt: string | null;
}

function toPublic(tree: GoalTree | null): PublicGoalTree {
  if (!tree) {
    return {
      schemaVersion: GOALS_SCHEMA_VERSION,
      l1s: [],
      cycleId: null,
      updatedAt: null,
    };
  }
  return {
    schemaVersion: GOALS_SCHEMA_VERSION,
    l1s: tree.l1s,
    cycleId: tree.cycleId ? tree.cycleId.toHexString() : null,
    updatedAt: tree.updatedAt.toISOString(),
  };
}

export async function getGoalsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const goals = await getGoalsCollection();
    const tree = await goals.findOne({
      orgId: session.orgId,
      userId: session.userId,
    });
    res.json(toPublic(tree));
  } catch (err) {
    next(err);
  }
}

export async function putGoalsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = goalsUpsertSchema.parse(req.body);
    const goals = await getGoalsCollection();
    const now = new Date();

    // Optimistic concurrency: when the client sent the `updatedAt` it
    // last saw, that timestamp joins the filter — atomically, so there
    // is no read-then-write race. A guarded write that matches nothing
    // means the tree moved (or appeared) underneath the caller: 409
    // with the current tree so the client can merge/resync in one hop.
    const token = payload.updatedAt;
    const guarded = token !== undefined;

    // F2 v1 — archive-on-replace. Snapshot the OUTGOING tree before it
    // is overwritten: replace used to destroy the only id→title mapping
    // for last cycle's goals, orphaning every spec/input/verdict/
    // snapshot row keyed to them. Read-before-guarded-update is sound:
    // if another writer lands in between, the guarded update below
    // conflicts (stale token) and no archive is inserted.
    let archiveSource: { l1s: unknown[] } | null = null;
    if (payload.archiveCurrent) {
      const goalsCol = await getGoalsCollection();
      const current = await goalsCol.findOne({
        orgId: session.orgId,
        userId: session.userId,
      });
      if (current && Array.isArray(current.l1s) && current.l1s.length > 0) {
        archiveSource = { l1s: current.l1s };
      }
    }

    const filter: Record<string, unknown> = {
      orgId: session.orgId,
      userId: session.userId,
    };
    if (token !== undefined) {
      // Non-null token → the stored tree must still carry it.
      // Null token → the caller believes NO tree exists: `$exists:false`
      // can never match a real doc (they all carry updatedAt), so a
      // racing creator makes the upsert insert-path collide with the
      // unique (orgId,userId) index → E11000 → 409 below. Both checks
      // are atomic — no read-then-write window.
      filter.updatedAt = token === null ? { $exists: false } : new Date(token);
    }

    // Replace semantics — the body fully describes the desired tree.
    // Guarded writes with a non-null token must NOT upsert: an upsert
    // on a filter that failed its precondition would try to mint a
    // second document instead of conflicting.
    const conflict = async (): Promise<never> => {
      // Hand back the live tree so the caller can resync without a
      // second GET.
      const current = await goals.findOne({
        orgId: session.orgId,
        userId: session.userId,
      });
      throw new HttpError(
        409,
        "goals_conflict",
        "Your goals changed in another tab or on another device. Refresh before saving again.",
        { current: toPublic(current) },
      );
    };

    let result;
    try {
      result = await goals.findOneAndUpdate(
        filter,
        {
          $set: {
            l1s: payload.l1s,
            schemaVersion: GOALS_SCHEMA_VERSION,
            updatedAt: now,
          },
          $setOnInsert: {
            orgId: session.orgId,
            userId: session.userId,
            cycleId: null,
          },
        },
        {
          upsert: !guarded || token === null,
          returnDocument: "after",
        },
      );
    } catch (err) {
      // Null-token upsert racing another creator: duplicate key on the
      // unique (orgId, userId) index.
      if ((err as { code?: number })?.code === 11000) return await conflict();
      throw err;
    }

    if (!result) {
      // Guarded write matched nothing → the token is stale.
      return await conflict();
    }

    // The replace landed — freeze the outgoing tree (best-effort: the
    // user's new tree must never fail because the archive write did).
    if (archiveSource) {
      try {
        const cycles = await getGoalCyclesCollection();
        const l1s = archiveSource.l1s as GoalL1[];
        const l2Count = l1s.reduce((s, l1) => s + (l1.l2s?.length ?? 0), 0);
        const report = await buildCycleReport(
          session.orgId,
          session.userId,
          l1s,
        );
        const archiveDoc = {
          orgId: session.orgId,
          userId: session.userId,
          label: payload.archiveCurrent!,
          tree: { l1s },
          ...(report ? { report } : {}),
          l1Count: l1s.length,
          l2Count,
          archivedAt: now,
        };
        await cycles.insertOne(archiveDoc as Parameters<typeof cycles.insertOne>[0]);
        // Keep the newest 10 archives per user.
        const stale = await cycles
          .find(
            { orgId: session.orgId, userId: session.userId },
            { projection: { _id: 1 }, sort: { archivedAt: -1 }, skip: 10 },
          )
          .toArray();
        if (stale.length > 0) {
          await cycles.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
        }
        await writeAudit({
          orgId: session.orgId,
          actorUserId: session.userId,
          actorRole: session.role,
          action: "goals.cycle_archived",
          targetType: "goal_cycle",
          targetId: payload.archiveCurrent!,
          after: { l1Count: l1s.length, l2Count },
          ...networkMeta(req),
        });
      } catch {
        // Archive failure is logged via audit absence only; the replace
        // itself already succeeded.
      }
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "goals.upsert",
      targetType: "goals",
      targetId: result._id.toHexString(),
      after: { l1Count: payload.l1s.length },
      ...networkMeta(req),
    });

    res.json(toPublic(result));
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/goals/cycles ────────────────────────────────────────

/** Meta-only list of the user's archived trees, newest first. */
/**
 * F2 v2 — the frozen report card. Joins the outgoing tree's goal ids
 * against the verdicts that exist RIGHT NOW, before the replace makes
 * them last cycle's orphans: the manager's verdict wins (it's the
 * review of record), else the latest whole-goal AI tier. Returns null
 * when nothing was ever graded (and on any error — an archive must
 * never fail because its report enrichment did).
 */
async function buildCycleReport(
  orgId: ObjectId,
  userId: ObjectId,
  l1s: GoalL1[],
): Promise<Record<string, GoalCycleReportRow> | null> {
  try {
    const goalIds: string[] = [];
    for (const l1 of l1s) {
      if (l1.id) goalIds.push(l1.id);
      for (const l2 of l1.l2s ?? []) if (l2.id) goalIds.push(l2.id);
    }
    if (goalIds.length === 0) return null;

    const report: Record<string, GoalCycleReportRow> = {};
    const aiVerdicts = await getGoalTierVerdictsCollection();
    for await (const v of aiVerdicts.find({
      orgId,
      userId,
      goalId: { $in: goalIds },
      periodKey: WHOLE_GOAL_TIER_KEY,
    })) {
      report[v.goalId] = {
        tier: v.verdict.tier,
        source: "ai",
        gradedAt: v.gradedAt,
        note: null,
      };
    }
    // Manager rows second — they overwrite the AI row for the same goal.
    const managerVerdicts = await getManagerGoalVerdictsCollection();
    for await (const v of managerVerdicts.find({
      orgId,
      subjectUserId: userId,
      goalId: { $in: goalIds },
    })) {
      report[v.goalId] = {
        tier: v.tier,
        source: "manager",
        gradedAt: v.gradedAt,
        note: v.note || null,
      };
    }
    return Object.keys(report).length > 0 ? report : null;
  } catch {
    return null;
  }
}

export async function listGoalCyclesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const cycles = await getGoalCyclesCollection();
    const rows = await cycles
      .find(
        { orgId: session.orgId, userId: session.userId },
        { projection: { tree: 0 }, sort: { archivedAt: -1 }, limit: 10 },
      )
      .toArray();
    res.json({
      cycles: rows.map((r) => ({
        id: r._id.toHexString(),
        label: r.label,
        l1Count: r.l1Count,
        l2Count: r.l2Count,
        archivedAt: r.archivedAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/goals/cycles/:id ────────────────────────────────────

/** One archived tree, read-only, in full. */
export async function getGoalCycleHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const rawId = req.params.id;
    if (typeof rawId !== "string" || !ObjectId.isValid(rawId)) {
      throw new HttpError(404, "not_found", "No such archive.");
    }
    const cycles = await getGoalCyclesCollection();
    const row = await cycles.findOne({
      _id: new ObjectId(rawId),
      orgId: session.orgId,
      userId: session.userId,
    });
    if (!row) {
      throw new HttpError(404, "not_found", "No such archive.");
    }
    res.json({
      id: row._id.toHexString(),
      label: row.label,
      l1Count: row.l1Count,
      l2Count: row.l2Count,
      archivedAt: row.archivedAt.toISOString(),
      tree: row.tree,
      // v1 archives predate the frozen report card — null, not {}.
      report: row.report
        ? Object.fromEntries(
            Object.entries(row.report).map(([goalId, r]) => [
              goalId,
              {
                tier: r.tier,
                source: r.source,
                gradedAt: r.gradedAt.toISOString(),
                note: r.note,
              },
            ]),
          )
        : null,
    });
  } catch (err) {
    next(err);
  }
}
