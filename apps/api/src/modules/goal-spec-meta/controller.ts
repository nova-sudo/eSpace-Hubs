/**
 * Goal-spec meta — when each of the caller's trackers was CREATED, plus the
 * caller's hire date.
 *
 * Creation time needs no new stored field: every goal_specs row is upserted
 * on (orgId, userId, goalId) and never re-inserted while it exists, so its
 * ObjectId timestamp IS the first-PUT time and is never overwritten. Two
 * refinements:
 *   - a row deleted and re-created ("Re-analyze all" wipes and re-saves
 *     every spec) would otherwise restart the clock, so the EARLIEST
 *     goal_inputs row for the goal also counts — an entry proves the tracker
 *     already existed. Entry `_id` time is used, not `ts` (a backfill's `ts`
 *     is the past window it is FOR, not when the tracker existed).
 *   - shared (assigned) goals aren't goal_specs rows — their tracker starts
 *     when the goal was assigned (`assigned_goals.createdAt`).
 */

import type { NextFunction, Request, Response } from "express";
import type { ObjectId } from "mongodb";
import { assignedGoalId } from "@espace-devhub/shared/goal-specs";
import {
  getAssignedGoalsCollection,
  getGoalInputsCollection,
  getGoalSpecsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import { HttpError } from "../../middleware/error-handler.js";

/** `spec.approval.reviewedAt` is epoch ms (legacy rows: an ISO string). */
function reviewedAtDate(v: unknown): Date | null {
  const ms = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

function earlier(a: Date | undefined, b: Date): Date {
  return a && a.getTime() <= b.getTime() ? a : b;
}

export async function getGoalSpecMetaHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const scope = { orgId: session.orgId, userId: session.userId };

    const created = new Map<string, Date>();

    // An approval-gated tracker (Build-your-own) can't be logged until its
    // manager approves it, so it starts counting at the DECISION, not the
    // day it was drafted — otherwise approving a quarterly tracker made the
    // report look behind overnight (it paced from the draft date / Jan 1).
    const approvedAt = new Map<string, Date>();
    const specs = await getGoalSpecsCollection();
    for await (const r of specs.find(scope, {
      projection: { _id: 1, goalId: 1, "spec.approval": 1 },
    })) {
      created.set(r.goalId, earlier(created.get(r.goalId), (r._id as ObjectId).getTimestamp()));
      const approval = (r.spec as { approval?: { status?: unknown; reviewedAt?: unknown } } | undefined)
        ?.approval;
      const at = reviewedAtDate(approval?.reviewedAt);
      if (approval?.status === "approved" && at) approvedAt.set(r.goalId, at);
    }

    const assigned = await getAssignedGoalsCollection();
    for await (const d of assigned.find(
      { orgId: session.orgId, assigneeIds: session.userId },
      { projection: { _id: 1, createdAt: 1 } },
    )) {
      const at = d.createdAt instanceof Date ? d.createdAt : d._id.getTimestamp();
      created.set(assignedGoalId(d._id.toHexString()), at);
    }

    // Earliest entry per goal — only for goals that have a tracker at all.
    if (created.size > 0) {
      const inputs = await getGoalInputsCollection();
      const firsts = await inputs
        .aggregate<{ _id: string; first: ObjectId }>([
          { $match: { ...scope, goalId: { $in: [...created.keys()] } } },
          { $group: { _id: "$goalId", first: { $min: "$_id" } } },
        ])
        .toArray();
      for (const f of firsts) {
        const cur = created.get(f._id);
        if (cur && f.first) created.set(f._id, earlier(cur, f.first.getTimestamp()));
      }
    }

    // Approval wins over both the row's age and any earlier entry: nothing
    // could be logged before it, so no earlier window was ever owed.
    for (const [goalId, at] of approvedAt) {
      const cur = created.get(goalId);
      if (!cur || at.getTime() > cur.getTime()) created.set(goalId, at);
    }

    const users = await getUsersCollection();
    const user = await users.findOne(
      { _id: session.userId, orgId: session.orgId },
      { projection: { hireDate: 1 } },
    );
    const hire = user?.hireDate instanceof Date ? user.hireDate : null;

    res.json({
      createdAt: Object.fromEntries([...created].map(([id, at]) => [id, at.toISOString()])),
      hireDate: hire ? hire.toISOString() : null,
    });
  } catch (err) {
    next(err);
  }
}
