/**
 * Goal-context controller — list / upsert / clear.
 *
 * Answer values are polymorphic (string / list / number / boolean) —
 * the spec's question kinds determine what's valid for each key.
 * We accept anything primitive-ish at the route layer; the widget
 * resolver on the frontend coerces per-question kind. (Future
 * tightening would have the spec available here so we can validate
 * cross-document — out of scope for M4.)
 *
 * PUT semantics: PARTIAL merge. Setting `value = null` for a
 * question removes that answer (matching the localStorage store's
 * behaviour). To clear all answers for a goal, DELETE.
 */

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getGoalContextCollection } from "../../db/collections.js";
import type { ContextAnswer, GoalContextDoc } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";

// Each value can be a string, number, boolean, list of strings, or
// null (= delete this key). The spec drives semantics; we just
// constrain shape.
const answerValue = z.union([
  z.string().max(8_000),
  z.number(),
  z.boolean(),
  z.array(z.string().max(2_000)).max(200),
  z.null(),
]);

const putContextSchema = z.object({
  answers: z.record(z.string().min(1).max(200), answerValue),
});

const goalIdParam = (req: Request): string => {
  const { goalId } = req.params;
  if (typeof goalId !== "string" || goalId.length === 0) {
    throw new HttpError(400, "validation_error", "Invalid goalId.");
  }
  if (goalId.length > 200) {
    throw new HttpError(400, "validation_error", "goalId too long.");
  }
  return goalId;
};

interface PublicContext {
  answers: Record<string, ContextAnswer>;
  updatedAt: string;
}

function toPublic(doc: GoalContextDoc): PublicContext {
  return {
    answers: doc.answers,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// ─── GET /api/v1/goal-context ────────────────────────────────────────

/**
 * Returns `{[goalId]: {answers, updatedAt}}` — same shape as the
 * frontend's localStorage-store would produce. The frontend's existing
 * `__updatedAt` field translates here to a top-level `updatedAt` key
 * on each goal's record.
 */
export async function listGoalContextHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const col = await getGoalContextCollection();
    const docs = await col
      .find({ orgId: session.orgId, userId: session.userId })
      .toArray();
    const out: Record<string, PublicContext> = {};
    for (const doc of docs) {
      out[doc.goalId] = toPublic(doc);
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/v1/goal-context/:goalId ────────────────────────────────

export async function putGoalContextHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const goalId = goalIdParam(req);
    const { answers: incoming } = putContextSchema.parse(req.body);

    const col = await getGoalContextCollection();
    const now = new Date();

    // Two-phase merge so partial updates work without a read-modify-
    // write race: $unset removes nulled keys, $set applies new values.
    const $set: Record<string, unknown> = {};
    const $unset: Record<string, "">  = {};
    for (const [key, value] of Object.entries(incoming)) {
      if (value === null) {
        $unset[`answers.${key}`] = "";
      } else {
        $set[`answers.${key}`] = value;
      }
    }
    $set.updatedAt = now;

    const update: Record<string, unknown> = {
      $set,
      $setOnInsert: {
        orgId: session.orgId,
        userId: session.userId,
        goalId,
      },
    };
    if (Object.keys($unset).length > 0) {
      update.$unset = $unset;
    }

    const result = await col.findOneAndUpdate(
      { orgId: session.orgId, userId: session.userId, goalId },
      update,
      { upsert: true, returnDocument: "after" },
    );

    if (!result) {
      throw new HttpError(500, "internal_error", "Context upsert failed.");
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "goal_context.upsert",
      targetType: "goal_context",
      targetId: goalId,
      after: { keys: Object.keys(incoming).length },
      ...networkMeta(req),
    });

    res.json(toPublic(result));
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/goal-context/:goalId ─────────────────────────────

export async function deleteGoalContextHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const goalId = goalIdParam(req);
    const col = await getGoalContextCollection();
    const result = await col.deleteOne({
      orgId: session.orgId,
      userId: session.userId,
      goalId,
    });
    if (result.deletedCount > 0) {
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        actorRole: session.role,
        action: "goal_context.delete",
        targetType: "goal_context",
        targetId: goalId,
        ...networkMeta(req),
      });
    }
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    next(err);
  }
}
