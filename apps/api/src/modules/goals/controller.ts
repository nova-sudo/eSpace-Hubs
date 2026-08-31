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
import { getGoalsCollection } from "../../db/collections.js";
import {
  GOALS_SCHEMA_VERSION,
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
