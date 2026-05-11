/**
 * Goal-specs controller — list / upsert / delete classified specs.
 *
 * The single-spec PUT runs the spec body through the same
 * `validateSpec` the classifier uses (`@espace-devhub/shared/goal-specs`),
 * so route-layer validation matches what the classifier emits exactly.
 *
 * Listing returns the same `{specs: {[goalId]: spec}, lastAnalyzedAt}`
 * shape the frontend's localStorage store uses, so swapping the
 * client storage layer is a one-line change.
 */

import type { NextFunction, Request, Response } from "express";
import { getGoalSpecsCollection } from "../../db/collections.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";
import { validateSpec } from "@espace-devhub/shared/goal-specs";
import type { ValidatedSpec } from "@espace-devhub/shared/goal-specs";

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

// ─── GET /api/v1/goal-specs ──────────────────────────────────────────

export async function listGoalSpecsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const col = await getGoalSpecsCollection();
    const records = await col
      .find({ orgId: session.orgId, userId: session.userId })
      .toArray();

    const specs: Record<string, unknown> = {};
    let lastAnalyzedAt = 0;
    for (const r of records) {
      specs[r.goalId] = r.spec;
      const ts = r.generatedAt.getTime();
      if (ts > lastAnalyzedAt) lastAnalyzedAt = ts;
    }
    res.json({ specs, lastAnalyzedAt });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/v1/goal-specs/:goalId ──────────────────────────────────

export async function putGoalSpecHandler(
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

    // The body must contain the spec object. We validate via
    // validateSpec — same code path the classifier uses, so we can't
    // accidentally accept a shape grading would reject later.
    const candidate = (req.body && typeof req.body === "object"
      ? req.body
      : {}) as Record<string, unknown>;

    // The classifier always sets goalId on the spec. If the caller
    // supplied one, prefer the URL parameter — they should match, but
    // a mismatch should be an error rather than silently picking the
    // body's value.
    if (
      typeof candidate.goalId === "string" &&
      candidate.goalId.length > 0 &&
      candidate.goalId !== goalId
    ) {
      throw new HttpError(
        400,
        "validation_error",
        `Body goalId "${candidate.goalId}" does not match URL goalId "${goalId}".`,
      );
    }

    const result = validateSpec({ ...candidate, goalId });
    if (!result.ok) {
      throw new HttpError(
        400,
        "validation_error",
        "Spec failed validation.",
        result.errors,
      );
    }

    const spec: ValidatedSpec = result.spec;
    const now = new Date();
    const classifierVersion =
      typeof candidate.classifierVersion === "string"
        ? (candidate.classifierVersion as string).slice(0, 200)
        : null;

    const col = await getGoalSpecsCollection();
    const upserted = await col.findOneAndUpdate(
      { orgId: session.orgId, userId: session.userId, goalId },
      {
        $set: {
          spec: spec as unknown as Record<string, unknown>,
          generatedAt: now,
          classifierVersion,
        },
        $setOnInsert: {
          orgId: session.orgId,
          userId: session.userId,
          goalId,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "goal_specs.upsert",
      targetType: "goal_spec",
      targetId: goalId,
      after: { widget: spec.widget, kind: spec.kind },
      ...networkMeta(req),
    });

    res.json({ spec: upserted?.spec ?? spec, generatedAt: now.toISOString() });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/goal-specs/:goalId ───────────────────────────────

export async function deleteGoalSpecHandler(
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
    const col = await getGoalSpecsCollection();
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
        action: "goal_specs.delete",
        targetType: "goal_spec",
        targetId: goalId,
        ...networkMeta(req),
      });
    }
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    next(err);
  }
}
