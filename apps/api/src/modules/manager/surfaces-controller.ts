/**
 * Express handlers for the §1.5 manager surfaces — thin wrappers that
 * wire the real collections into ./report-surfaces.ts (where the logic
 * and the authorization boundary live, unit-tested against fakes).
 * See routes.ts for the endpoint list.
 */

import type { NextFunction, Request, Response } from "express";
import type { ObjectId } from "mongodb";
import { assignedGoalId, isAssignedGoalId } from "@espace-devhub/shared/goal-specs";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import {
  getAssignedGoalsCollection,
  getGoalsCollection,
  getManagerGoalVerdictEventsCollection,
  getManagerReportNotesCollection,
  getSnapshotsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import {
  asMini,
  createReportNote,
  deleteReportNote,
  listReportNotes,
  reportSnapshots,
  teamGradingProgress,
  teamTrends,
  updateReportNote,
  type SurfaceDeps,
} from "./report-surfaces.js";

/**
 * Every current goal id on each report's board (own tree + active assigned
 * goals — the same set `withAssignedTree` yields), for a whole team in two
 * queries instead of two per report.
 */
async function goalIdsFor(
  orgId: ObjectId,
  userIds: ObjectId[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(userIds.map((id) => [id.toHexString(), []]));
  if (userIds.length === 0) return out;
  const [trees, assigned] = await Promise.all([
    getGoalsCollection().then((c) =>
      c
        .find(
          { orgId, userId: { $in: userIds } },
          { projection: { userId: 1, "l1s.id": 1, "l1s.l2s.id": 1 } },
        )
        .toArray(),
    ),
    getAssignedGoalsCollection().then((c) =>
      c
        .find(
          { orgId, status: "active", assigneeIds: { $in: userIds } },
          { projection: { _id: 1, assigneeIds: 1 } },
        )
        .sort({ createdAt: 1 })
        .toArray(),
    ),
  ]);
  for (const t of trees) {
    const ids = out.get(t.userId.toHexString());
    if (!ids) continue;
    for (const l1 of t.l1s ?? []) {
      // Synthetic shared-goal nodes are never stored, but strip them the
      // way withAssignedTree does in case an old write left one behind.
      if (isAssignedGoalId(l1.id)) continue;
      for (const l2 of l1.l2s ?? []) {
        if (!isAssignedGoalId(l2.id)) ids.push(l2.id);
      }
    }
  }
  for (const a of assigned) {
    const gid = assignedGoalId(a._id.toHexString());
    for (const uid of a.assigneeIds ?? []) {
      out.get(uid.toHexString())?.push(gid);
    }
  }
  return out;
}

async function liveDeps(): Promise<SurfaceDeps> {
  const [users, snapshots, verdictEvents, notes] = await Promise.all([
    getUsersCollection(),
    getSnapshotsCollection(),
    getManagerGoalVerdictEventsCollection(),
    getManagerReportNotesCollection(),
  ]);
  return {
    users: asMini(users),
    snapshots: asMini(snapshots),
    verdictEvents: asMini(verdictEvents),
    notes: asMini(notes),
    goalIdsFor,
    audit: writeAudit,
  };
}

type Run = (req: Request, deps: SurfaceDeps) => Promise<unknown>;

function handler(run: Run) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await run(req, await liveDeps()));
    } catch (err) {
      next(err);
    }
  };
}

/** GET /manager/grading-progress?periodKey=2026 */
export const getGradingProgressHandler = handler((req, deps) =>
  teamGradingProgress(req.session, req.query.periodKey, deps),
);

/** GET /manager/team-trends?weeks=12 */
export const getTeamTrendsHandler = handler((req, deps) =>
  teamTrends(req.session, req.query.weeks, deps),
);

/** GET /manager/reports/:userId/snapshots?weeks=12 */
export const getReportSnapshotsHandler = handler((req, deps) =>
  reportSnapshots(req.session, req.params.userId, req.query.weeks, deps),
);

/** GET /manager/reports/:userId/notes */
export const listReportNotesHandler = handler((req, deps) =>
  listReportNotes(req.session, req.params.userId, deps),
);

/** POST /manager/reports/:userId/notes */
export const createReportNoteHandler = handler((req, deps) =>
  createReportNote(req.session, req.params.userId, req.body, networkMeta(req), deps),
);

/** PATCH /manager/reports/:userId/notes/:noteId */
export const updateReportNoteHandler = handler((req, deps) =>
  updateReportNote(
    req.session,
    req.params.userId,
    req.params.noteId,
    req.body,
    networkMeta(req),
    deps,
  ),
);

/** DELETE /manager/reports/:userId/notes/:noteId */
export const deleteReportNoteHandler = handler((req, deps) =>
  deleteReportNote(req.session, req.params.userId, req.params.noteId, networkMeta(req), deps),
);
