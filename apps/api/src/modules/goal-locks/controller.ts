/**
 * Goal-locks controller — the settle-locks ("this period is finalised")
 * as one keys-array document per user.
 *
 * Why server-side (BL-011's last holdout): the cadence-consistency cap
 * on displayed achievement tiers reads these locks. While they lived in
 * device-local localStorage, the SAME goal showed different tiers on
 * different devices, and a re-login (which wipes user-scoped storage)
 * silently degraded the user's own badge. The client keeps localStorage
 * as a warm-start cache; this collection is the source of truth.
 *
 * PUT semantics: PARTIAL — `set` adds keys, `clear` removes keys, both
 * atomic ($addToSet/$pull), no read-modify-write race between tabs.
 */

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getGoalLocksCollection } from "../../db/collections.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";

const lockKey = z.string().min(1).max(400);
const putLocksSchema = z
  .object({
    set: z.array(lockKey).max(500).optional(),
    clear: z.array(lockKey).max(500).optional(),
  })
  .refine((b) => (b.set?.length || 0) + (b.clear?.length || 0) > 0, {
    message: "Provide set and/or clear.",
  });

// ─── GET /api/v1/goal-locks ──────────────────────────────────────────

export async function listGoalLocksHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const col = await getGoalLocksCollection();
    const doc = await col.findOne({
      orgId: session.orgId,
      userId: session.userId,
    });
    res.json({
      keys: doc?.keys ?? [],
      updatedAt: doc?.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/v1/goal-locks ──────────────────────────────────────────

export async function putGoalLocksHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const body = putLocksSchema.parse(req.body);
    const set = [...new Set(body.set ?? [])];
    const clear = new Set(body.clear ?? []);
    // A key both set and cleared in one call: clear wins (matches the
    // client's last-action-wins toggle semantics).
    const toAdd = set.filter((k) => !clear.has(k));
    const toRemove = [...clear];

    const col = await getGoalLocksCollection();
    const now = new Date();

    // Two atomic ops instead of one because Mongo forbids $addToSet and
    // $pull on the same field in a single update. Ordering: adds first,
    // removals second, so the one-call set+clear overlap resolves to
    // "cleared" (see above).
    if (toAdd.length > 0) {
      await col.updateOne(
        { orgId: session.orgId, userId: session.userId },
        {
          $addToSet: { keys: { $each: toAdd } },
          $set: { updatedAt: now },
          $setOnInsert: { orgId: session.orgId, userId: session.userId },
        },
        { upsert: true },
      );
    }
    if (toRemove.length > 0) {
      await col.updateOne(
        { orgId: session.orgId, userId: session.userId },
        {
          $pull: { keys: { $in: toRemove } },
          $set: { updatedAt: now },
          $setOnInsert: { orgId: session.orgId, userId: session.userId },
        },
        { upsert: true },
      );
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "goal_locks.update",
      targetType: "goal_locks",
      targetId: session.userId.toHexString(),
      after: { set: toAdd.length, cleared: toRemove.length },
      ...networkMeta(req),
    });

    const doc = await col.findOne({
      orgId: session.orgId,
      userId: session.userId,
    });
    res.json({
      keys: doc?.keys ?? [],
      updatedAt: doc?.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
}
