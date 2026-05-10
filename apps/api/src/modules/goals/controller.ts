/**
 * Goals controller — GET + PUT for the user's L1/L2 tree.
 *
 * One tree per (orgId, userId). The unique index on
 * (orgId, userId) means a buggy parallel write loses cleanly with
 * MongoServerError E11000 — caller sees 409 conflict, not silent
 * data overwrite.
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

    // Replace semantics — the body fully describes the desired tree.
    // `$set` of l1s handles partial-tree edits the frontend may send;
    // using `replaceOne` with `upsert` is equivalent here.
    const result = await goals.findOneAndUpdate(
      { orgId: session.orgId, userId: session.userId },
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
      { upsert: true, returnDocument: "after" },
    );

    if (!result) {
      // Should be unreachable with upsert + returnDocument:"after",
      // but TypeScript doesn't model that — defensive fallback.
      throw new HttpError(500, "internal_error", "Goals upsert failed.");
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
