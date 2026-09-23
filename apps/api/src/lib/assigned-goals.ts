/**
 * Assigned (shared) goals — the merge-at-read helpers.
 *
 * An assigned goal is NEVER written into an assignee's `goals` doc or their
 * `goal_specs`. Every reader that wants "this person's goals including the
 * ones shared with them" goes through `effectiveTree` / `effectiveSpecDocs`
 * here, and every writer of the own tree runs `stripAssigned` so a client
 * that echoes back a merged tree can't persist the synthetic nodes.
 *
 * Shape in the assignee's tree: one synthetic L1 (`asg__root`, "Shared
 * goals", weightage 0 so it never moves the owner's weighted headline)
 * holding one L2 per active assigned goal, id `asg_<assigned_goals._id>`.
 */

import { ObjectId } from "mongodb";
import {
  assignedGoalId,
  isAssignedGoalId,
  parseAssignedGoalId,
} from "@espace-devhub/shared/goal-specs";
import { resolveHubsForCapabilities } from "@espace-devhub/shared/hubs";
import { getAssignedGoalsCollection } from "../db/collections.js";
import type { AssignedGoal, GoalL1, User } from "../db/types.js";
import {
  assignedSpecFor,
  stripAssigned,
  syntheticAssignedL1,
} from "./assigned-goals-tree.js";

export {
  assignedSpecFor,
  stripAssigned,
  syntheticAssignedL1,
  syntheticAssignedL2,
} from "./assigned-goals-tree.js";
import { HttpError } from "../middleware/error-handler.js";
import { effectiveCapabilities } from "./user-roles.js";

export const ASSIGNEES_MAX = 500;
export const VIEWERS_MAX = 100;

/** Active assigned goals where `userId` is an assignee, oldest first. */
export async function listActiveAssignedFor(
  orgId: ObjectId,
  userId: ObjectId,
): Promise<AssignedGoal[]> {
  const col = await getAssignedGoalsCollection();
  return col
    .find({ orgId, assigneeIds: userId, status: "active" })
    .sort({ createdAt: 1 })
    .toArray();
}

/** Own tree + the synthetic "Shared goals" L1 (appended last). */
export async function effectiveTree(
  orgId: ObjectId,
  userId: ObjectId,
  ownL1s: GoalL1[] | null | undefined,
): Promise<GoalL1[]> {
  const own = stripAssigned(ownL1s ?? []);
  const root = syntheticAssignedL1(await listActiveAssignedFor(orgId, userId));
  return root ? [...own, root] : own;
}

/**
 * Own spec records + one synthetic record per active assigned goal, in the
 * `{goalId, spec, generatedAt}` shape readers of `goal_specs` expect.
 */
export async function effectiveSpecDocs<
  R extends { goalId: string; spec: Record<string, unknown>; generatedAt: Date },
>(
  orgId: ObjectId,
  userId: ObjectId,
  ownRecords: R[],
): Promise<Array<R | { goalId: string; spec: Record<string, unknown>; generatedAt: Date }>> {
  const own = ownRecords.filter((r) => !isAssignedGoalId(r.goalId));
  const docs = await listActiveAssignedFor(orgId, userId);
  return [
    ...own,
    ...docs.map((d) => ({
      goalId: assignedGoalId(d._id.toHexString()),
      spec: assignedSpecFor(d),
      generatedAt: d.updatedAt,
    })),
  ];
}

/**
 * The active assigned goal behind `goalId` that `userId` may WRITE entries
 * to — 403 otherwise. Called by the goal-inputs append path.
 */
export async function requireActiveAssignee(
  orgId: ObjectId,
  userId: ObjectId,
  goalId: string,
): Promise<AssignedGoal> {
  const hex = parseAssignedGoalId(goalId);
  const col = await getAssignedGoalsCollection();
  const doc = hex
    ? await col.findOne({
        _id: new ObjectId(hex),
        orgId,
        assigneeIds: userId,
        status: "active",
      })
    : null;
  if (!doc) {
    throw new HttpError(
      403,
      "assigned_goal_forbidden",
      "This shared goal isn't assigned to you (or has been archived).",
    );
  }
  return doc;
}

/**
 * Can this user FILL a goal — i.e. does any hub they can enter carry a
 * Goals page? Managers/admins without a dev/qa role can't: their hubs have
 * no goal tree to show an assigned goal in.
 */
export function canFillGoals(u: Pick<User, "role" | "roles">): boolean {
  const hubs = resolveHubsForCapabilities(effectiveCapabilities(u)) as Array<{
    pages?: Record<string, string>;
  }>;
  return hubs.some((h) => Boolean(h.pages?.goals));
}

/**
 * A stored tree (or null) with the shared-goals L1 merged in — for server
 * readers that walk `tree.l1s` (manager board, verdict title lookup, the
 * dev's own tier-policy resolution). Null only when there is neither.
 */
export async function withAssignedTree<T extends { l1s: GoalL1[] }>(
  orgId: ObjectId,
  userId: ObjectId,
  tree: T | null,
): Promise<T | null> {
  const l1s = await effectiveTree(orgId, userId, tree?.l1s);
  if (!tree && l1s.length === 0) return null;
  return { ...(tree ?? ({} as T)), l1s };
}

/** The synthetic spec record for one `asg_` goal id this user is assigned, or null. */
export async function assignedSpecRecordFor(
  orgId: ObjectId,
  userId: ObjectId,
  goalId: string,
): Promise<{ goalId: string; spec: Record<string, unknown>; generatedAt: Date } | null> {
  const hex = parseAssignedGoalId(goalId);
  if (!hex) return null;
  const col = await getAssignedGoalsCollection();
  const doc = await col.findOne({ _id: new ObjectId(hex), orgId, assigneeIds: userId });
  return doc ? { goalId, spec: assignedSpecFor(doc), generatedAt: doc.updatedAt } : null;
}
