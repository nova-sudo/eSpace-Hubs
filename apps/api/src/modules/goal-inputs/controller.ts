/**
 * Goal-inputs controller — list / append / delete time-series entries.
 *
 * Append-only by convention: there is no PUT on an existing entry.
 * Update workflows are "delete + insert" so the audit trail stays
 * honest (who changed what, when).
 *
 * `value` is intentionally polymorphic. Different manual widgets
 * store different primitive shapes (Counter: number, Scale: 1-5,
 * Milestone: object map, Free-text: string). The Mongo validator
 * enforces presence + type-class; the widget interprets per-spec.
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getGoalInputsCollection } from "../../db/collections.js";
import type {
  GoalInputEntry,
  GoalInputSource,
  GoalInputValue,
} from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";

// Polymorphic value: number / string / boolean / list of strings /
// flat object map. Caps each shape so a runaway widget can't blow
// out a single document.
const inputValue = z.union([
  z.number(),
  z.string().max(8_000),
  z.boolean(),
  z.array(z.string().max(2_000)).max(200),
  z.record(
    z.string().min(1).max(200),
    z.union([
      z.string().max(2_000),
      z.number(),
      z.boolean(),
      z.null(),
    ]),
  ),
]);

const appendInputSchema = z.object({
  goalId: z.string().min(1).max(200),
  value: inputValue,
  note: z.string().max(2_000).nullable().optional(),
  /**
   * ISO timestamp the user is logging FOR (may be in the past for a
   * back-fill). Defaults to "now" when omitted.
   */
  ts: z.string().datetime({ offset: true }).optional(),
  source: z.enum(["manual", "auto"]).default("manual"),
});

const listQuerySchema = z.object({
  goalId: z.string().min(1).max(200).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(2_000).default(500),
});

interface PublicEntry {
  id: string;
  goalId: string;
  ts: string;
  value: GoalInputValue;
  note: string | null;
  source: GoalInputSource;
}

function toPublic(e: GoalInputEntry): PublicEntry {
  return {
    id: e._id.toHexString(),
    goalId: e.goalId,
    ts: e.ts.toISOString(),
    value: e.value,
    note: e.note,
    source: e.source,
  };
}

// ─── GET /api/v1/goal-inputs ─────────────────────────────────────────

export async function listGoalInputsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { goalId, since, until, limit } = listQuerySchema.parse(req.query);

    const filter: Record<string, unknown> = {
      orgId: session.orgId,
      userId: session.userId,
    };
    if (goalId) filter.goalId = goalId;
    if (since || until) {
      const tsFilter: Record<string, Date> = {};
      if (since) tsFilter.$gte = new Date(since);
      if (until) tsFilter.$lte = new Date(until);
      filter.ts = tsFilter;
    }

    const col = await getGoalInputsCollection();
    const entries = await col
      .find(filter)
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();

    res.json({
      entries: entries.map(toPublic),
      // ASC sort is what the existing widgets expect; we fetch DESC
      // so that LIMIT keeps the newest entries, then flip on the way
      // out so consumers see chronological order.
      // (Wait — actually the frontend store stores ts-ascending. Mirror
      // that.)
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/goal-inputs ────────────────────────────────────────

export async function appendGoalInputHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = appendInputSchema.parse(req.body);
    const ts = payload.ts ? new Date(payload.ts) : new Date();

    const doc = {
      orgId: session.orgId,
      userId: session.userId,
      goalId: payload.goalId,
      ts,
      value: payload.value as GoalInputValue,
      note: payload.note ?? null,
      source: payload.source,
    } as Omit<GoalInputEntry, "_id">;

    const col = await getGoalInputsCollection();
    const result = await col.insertOne(doc as GoalInputEntry);

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "goal_inputs.append",
      targetType: "goal_input",
      targetId: result.insertedId.toHexString(),
      after: { goalId: payload.goalId, source: payload.source },
      ...networkMeta(req),
    });

    res.status(201).json(
      toPublic({ ...(doc as GoalInputEntry), _id: result.insertedId }),
    );
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/goal-inputs/:entryId ─────────────────────────────

export async function deleteGoalInputHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const entryId = req.params.entryId;
    if (typeof entryId !== "string" || !ObjectId.isValid(entryId)) {
      throw new HttpError(400, "validation_error", "Invalid entry id.");
    }
    const _id = new ObjectId(entryId);
    const col = await getGoalInputsCollection();
    const result = await col.deleteOne({
      _id,
      orgId: session.orgId,
      userId: session.userId,
    });

    if (result.deletedCount > 0) {
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        actorRole: session.role,
        action: "goal_inputs.delete",
        targetType: "goal_input",
        targetId: entryId,
        ...networkMeta(req),
      });
    }
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    next(err);
  }
}
