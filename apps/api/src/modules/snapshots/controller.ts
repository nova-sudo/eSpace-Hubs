/**
 * Snapshots controller — list / upsert / patch / delete.
 *
 * Manual-wins-over-auto precedence (the headline rule):
 *   When an INCOMING snapshot has capturedBy:"auto" AND the existing
 *   snapshot for the same week has capturedBy:"manual", the
 *   controller keeps the manual record (`precedence: "manual_kept"`).
 *   The one thing an auto capture may add is `goalReadings` the manual
 *   row never had — a "Snapshot now" click carries no per-goal
 *   readings, and refusing them outright left the week without any.
 *
 * Manual merges, not replaces:
 *   A manual capture that arrives with an empty `goalReadings` or an
 *   empty `note` keeps the existing row's values for those fields, so a
 *   mid-week / weekend "Snapshot now" doesn't erase the completed
 *   week's readings or the user's note.
 *
 * Week keys:
 *   Rows are keyed "W36-2026" (year-qualified — the scheduler and the
 *   client agree on this shape). Rows written before the client
 *   carried a year are keyed "W36"; reads, patches and deletes for the
 *   current year fall back to that legacy key, and an upsert migrates
 *   the legacy row onto the qualified key.
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

/**
 * Every key a request for `week` may match, most specific first: the
 * key itself, then — for a year-qualified key in the CURRENT year — the
 * legacy year-less form rows carried before keys had a year. (Only the
 * current year: a legacy "W36" could only have been written this year,
 * since older years were never stored without a suffix.)
 */
function weekKeyCandidates(week: string, now = new Date()): string[] {
  const m = /^W([0-9]{1,2})-([0-9]{4})$/.exec(week);
  if (!m) return [week];
  const year = Number(m[2]);
  if (year !== now.getUTCFullYear()) return [week];
  return [week, `W${m[1]}`];
}

function hasReadings(readings: Record<string, GoalReading> | undefined): boolean {
  return !!readings && Object.keys(readings).length > 0;
}

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

    // Find the row this write lands on — the qualified key first, then
    // a legacy year-less row for the same week (migrated below).
    const candidates = weekKeyCandidates(payload.week);
    let existing: Snapshot | null = null;
    for (const key of candidates) {
      existing = await col.findOne({
        orgId: session.orgId,
        userId: session.userId,
        week: key,
      });
      if (existing) break;
    }

    // Manual-wins-over-auto: keep the hand-captured row. The auto
    // capture may only contribute goalReadings the manual row lacks.
    if (
      existing &&
      existing.capturedBy === "manual" &&
      payload.capturedBy === "auto"
    ) {
      const needsReadings =
        !hasReadings(existing.goalReadings) && hasReadings(payload.goalReadings);
      const needsRename = existing.week !== payload.week;
      let kept: Snapshot = existing;
      if (needsReadings || needsRename) {
        const patched = await col.findOneAndUpdate(
          { _id: existing._id },
          {
            $set: {
              ...(needsRename ? { week: payload.week } : {}),
              ...(needsReadings ? { goalReadings: payload.goalReadings } : {}),
            },
          },
          { returnDocument: "after" },
        );
        if (patched) kept = patched;
      }
      res.status(200).json({
        snapshot: toPublic(kept),
        precedence: "manual_kept",
      });
      return;
    }

    const capturedAt = payload.capturedAt
      ? new Date(payload.capturedAt)
      : new Date();

    // Merge, don't blank: a manual "Snapshot now" carries no per-goal
    // readings and usually no note — keep what the row already has.
    const goalReadings =
      hasReadings(payload.goalReadings) || !existing
        ? payload.goalReadings
        : existing.goalReadings;
    const note = payload.note || existing?.note || "";

    const filter = existing
      ? { _id: existing._id }
      : {
          orgId: session.orgId,
          userId: session.userId,
          week: payload.week,
        };

    const result = await col.findOneAndUpdate(
      filter,
      {
        $set: {
          // Migrates a legacy "W36" row onto "W36-2026" in passing.
          week: payload.week,
          capturedAt,
          capturedBy: payload.capturedBy,
          merged: payload.merged,
          reviews: payload.reviews,
          turnaround: payload.turnaround,
          linkage: payload.linkage,
          rounds: payload.rounds,
          note,
          goalReadings,
          partial: payload.partial,
          gaps: payload.gaps,
        },
        $setOnInsert: {
          orgId: session.orgId,
          userId: session.userId,
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
    let result: Snapshot | null = null;
    for (const key of weekKeyCandidates(week)) {
      result = await col.findOneAndUpdate(
        {
          orgId: session.orgId,
          userId: session.userId,
          week: key,
        },
        { $set },
        { returnDocument: "after" },
      );
      if (result) break;
    }

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
    // Deletes every key this week may live under (qualified + legacy).
    const result = await col.deleteMany({
      orgId: session.orgId,
      userId: session.userId,
      week: { $in: weekKeyCandidates(week) },
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
