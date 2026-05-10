/**
 * Snapshots controller — list / upsert / patch / delete.
 *
 * Manual-wins-over-auto precedence (the headline rule):
 *   When an INCOMING snapshot has capturedBy:"auto" AND the existing
 *   snapshot for the same week has capturedBy:"manual", the
 *   controller returns the existing record unchanged. The frontend's
 *   saveSnapshot() applies the same rule locally; this server check
 *   protects against direct API writes (e.g. a stale auto-snapshotter
 *   running in another tab while the user manually captured the
 *   week with a note).
 */

import type { NextFunction, Request, Response } from "express";
import { getSnapshotsCollection } from "../../db/collections.js";
import type {
  GoalReading,
  Snapshot,
  SnapshotCapturedBy,
} from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  listQuerySchema,
  patchSnapshotSchema,
  upsertSnapshotSchema,
} from "./schemas.js";

interface PublicSnapshot {
  week: string;
  capturedAt: string;
  capturedBy: SnapshotCapturedBy;
  merged: number;
  reviews: number;
  turnaround: number;
  linkage: number;
  rounds: number;
  note: string;
  goalReadings: Record<string, GoalReading>;
  partial: boolean;
  gaps: string[];
}

function toPublic(s: Snapshot): PublicSnapshot {
  return {
    week: s.week,
    capturedAt: s.capturedAt.toISOString(),
    capturedBy: s.capturedBy,
    merged: s.merged,
    reviews: s.reviews,
    turnaround: s.turnaround,
    linkage: s.linkage,
    rounds: s.rounds,
    note: s.note,
    goalReadings: s.goalReadings,
    partial: s.partial,
    gaps: s.gaps,
  };
}

const weekParam = (req: Request): string => {
  const { week } = req.params;
  if (typeof week !== "string" || week.length === 0) {
    throw new HttpError(400, "validation_error", "Invalid week label.");
  }
  if (!/^W[0-9]{1,2}(-[0-9]{4})?$/.test(week)) {
    throw new HttpError(
      400,
      "validation_error",
      "week must be W## or W##-YYYY.",
    );
  }
  return week;
};

// ─── GET /api/v1/snapshots ───────────────────────────────────────────

export async function listSnapshotsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { since, until, limit } = listQuerySchema.parse(req.query);
    const col = await getSnapshotsCollection();

    const filter: Record<string, unknown> = {
      orgId: session.orgId,
      userId: session.userId,
    };
    if (since || until) {
      const range: Record<string, Date> = {};
      if (since) range.$gte = new Date(since);
      if (until) range.$lte = new Date(until);
      filter.capturedAt = range;
    }

    // Most-recent-first by capturedAt — matches dashboard ordering.
    const snapshots = await col
      .find(filter)
      .sort({ capturedAt: -1 })
      .limit(limit)
      .toArray();

    res.json({ snapshots: snapshots.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/snapshots ──────────────────────────────────────────

export async function upsertSnapshotHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = upsertSnapshotSchema.parse(req.body);
    const col = await getSnapshotsCollection();

    // Manual-wins-over-auto: if incoming is auto, check first whether a
    // manual capture already exists for this week. If so, return it
    // unchanged — the auto-snapshotter shouldn't clobber a hand-
    // captured note.
    const existing = await col.findOne({
      orgId: session.orgId,
      userId: session.userId,
      week: payload.week,
    });

    if (
      existing &&
      existing.capturedBy === "manual" &&
      payload.capturedBy === "auto"
    ) {
      res.status(200).json({
        snapshot: toPublic(existing),
        precedence: "manual_kept",
      });
      return;
    }

    const capturedAt = payload.capturedAt
      ? new Date(payload.capturedAt)
      : new Date();

    const result = await col.findOneAndUpdate(
      {
        orgId: session.orgId,
        userId: session.userId,
        week: payload.week,
      },
      {
        $set: {
          capturedAt,
          capturedBy: payload.capturedBy,
          merged: payload.merged,
          reviews: payload.reviews,
          turnaround: payload.turnaround,
          linkage: payload.linkage,
          rounds: payload.rounds,
          note: payload.note,
          goalReadings: payload.goalReadings,
          partial: payload.partial,
          gaps: payload.gaps,
        },
        $setOnInsert: {
          orgId: session.orgId,
          userId: session.userId,
          week: payload.week,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    if (!result) {
      throw new HttpError(500, "internal_error", "Snapshot upsert failed.");
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: payload.capturedBy === "auto"
        ? "snapshots.auto_capture"
        : "snapshots.manual_capture",
      targetType: "snapshot",
      targetId: result._id.toHexString(),
      after: { week: payload.week, capturedBy: payload.capturedBy },
      ...networkMeta(req),
    });

    res.json({ snapshot: toPublic(result), precedence: "applied" });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/v1/snapshots/:week ───────────────────────────────────

export async function patchSnapshotHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const week = weekParam(req);
    const patch = patchSnapshotSchema.parse(req.body);

    const $set: Record<string, unknown> = {};
    if (patch.note !== undefined) $set.note = patch.note;
    if (patch.goalReadings !== undefined) {
      $set.goalReadings = patch.goalReadings;
    }
    if (Object.keys($set).length === 0) {
      throw new HttpError(
        400,
        "validation_error",
        "Patch body must include at least one mutable field.",
      );
    }

    const col = await getSnapshotsCollection();
    const result = await col.findOneAndUpdate(
      {
        orgId: session.orgId,
        userId: session.userId,
        week,
      },
      { $set },
      { returnDocument: "after" },
    );

    if (!result) {
      throw new HttpError(404, "not_found", `No snapshot for week ${week}.`);
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "snapshots.patch",
      targetType: "snapshot",
      targetId: result._id.toHexString(),
      after: { fields: Object.keys($set) },
      ...networkMeta(req),
    });

    res.json(toPublic(result));
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/snapshots/:week ──────────────────────────────────

export async function deleteSnapshotHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const week = weekParam(req);
    const col = await getSnapshotsCollection();
    const result = await col.deleteOne({
      orgId: session.orgId,
      userId: session.userId,
      week,
    });

    if (result.deletedCount > 0) {
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        actorRole: session.role,
        action: "snapshots.delete",
        targetType: "snapshot",
        targetId: week,
        ...networkMeta(req),
      });
    }
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    next(err);
  }
}
