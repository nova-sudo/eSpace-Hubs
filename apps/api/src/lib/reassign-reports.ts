/**
 * Bulk "move every report of manager A to manager B" — the server half of
 * hub-audit §1.4 ("nothing strands when a manager is disabled or leaves").
 *
 * The admin module owns the endpoint + UI and calls this. It does NOT write
 * an audit row itself: the caller audits (action `admin.user.reassign_reports`
 * or similar) using `result.audit` as before/after, so the actor/IP metadata
 * comes from the request that triggered it.
 *
 * What moves:
 *   1. users.managerId  from → to, for every report of `from` in the org
 *      (disabled reports included, so no row points at a departed manager).
 *   2. Pending BYO approvals of those reports. The approvals queue is
 *      resolved from managerId at read time, so step 1 already re-routes
 *      them; this also re-stamps `spec.approval.managerName` on the stored
 *      pending spec and sends the new manager one `goal_submitted` inbox
 *      row per waiting approval, so they arrive in the bell instead of
 *      sitting silently in a queue.
 *
 * Refuses (throws HttpError 400/404) when: from === to; `to` isn't an
 * active user in the org holding `manager.team.view`. `to === null` means
 * "unassign" — reports end up with no manager (the admin UI should say so).
 *
 * Skips, per report (returned in `skipped`, never silently):
 *   - the new manager themself (they'd manage themselves)
 *   - any report above the new manager in the org chart (the move would
 *     create a cycle, e.g. to = D who reports to C, and C is being moved
 *     under D)
 */

import type { Collection, ObjectId } from "mongodb";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";
import { getGoalSpecsCollection, getUsersCollection } from "../db/collections.js";
import type { GoalSpecRecord, User } from "../db/types.js";
import { HttpError } from "../middleware/error-handler.js";
import { createNotification } from "./notifications.js";
import { effectiveCapabilities } from "./user-roles.js";

export interface ReassignReportsInput {
  orgId: ObjectId;
  fromManagerId: ObjectId;
  /** `null` unassigns — the reports end up with no manager. */
  toManagerId: ObjectId | null;
  /** Who triggered it — stamped as `createdBy` on the inbox rows. */
  actorUserId?: ObjectId | null;
  now?: Date;
}

export interface ReassignReportsResult {
  /** Hex ids of the reports whose managerId moved. */
  reassigned: string[];
  skipped: { userId: string; reason: "is_new_manager" | "would_create_cycle" }[];
  /** Pending approvals re-routed to the new manager. */
  pendingApprovals: number;
  toManagerName: string | null;
  /** Ready-made before/after for the caller's audit row. */
  audit: {
    before: { managerId: string; reportIds: string[] };
    after: { managerId: string | null; reportIds: string[]; pendingApprovals: number };
  };
}

type UsersCol = Pick<Collection<User>, "find" | "findOne" | "updateMany">;
type SpecsCol = Pick<Collection<GoalSpecRecord>, "find" | "updateMany">;

/** Injectable dependencies — production defaults; tests pass fakes. */
export interface ReassignReportsDeps {
  users: UsersCol;
  goalSpecs: SpecsCol;
  notify: typeof createNotification;
}

/** How far up the org chart the cycle check walks before giving up. */
const MAX_CHAIN_DEPTH = 64;

function label(u: Pick<User, "displayName" | "email"> | null): string | null {
  if (!u) return null;
  const name = (u.displayName ?? "").trim();
  if (name) return name.slice(0, 200);
  const email = (u.email ?? "").trim();
  return email ? email.slice(0, 200) : null;
}

export async function reassignReports(
  input: ReassignReportsInput,
  deps?: Partial<ReassignReportsDeps>,
): Promise<ReassignReportsResult> {
  const users = deps?.users ?? (await getUsersCollection());
  const goalSpecs = deps?.goalSpecs ?? (await getGoalSpecsCollection());
  const notify = deps?.notify ?? createNotification;
  const { orgId, fromManagerId, toManagerId } = input;
  const now = input.now ?? new Date();

  if (toManagerId && toManagerId.equals(fromManagerId)) {
    throw new HttpError(400, "same_manager", "Pick a different manager to move the reports to.");
  }

  let toManager: User | null = null;
  if (toManagerId) {
    toManager = await users.findOne({ _id: toManagerId, orgId });
    if (!toManager) {
      throw new HttpError(404, "not_found", "That manager isn't in this org.");
    }
    if (toManager.status !== "active") {
      throw new HttpError(400, "manager_inactive", "The new manager's account isn't active.");
    }
    if (!effectiveCapabilities(toManager).has(CAPABILITIES.MANAGER_TEAM_VIEW)) {
      throw new HttpError(
        400,
        "not_a_manager",
        "The new manager doesn't hold the manager role — they couldn't see their team.",
      );
    }
  }

  const reports = await users.find({ orgId, managerId: fromManagerId }).toArray();

  // The new manager's chain of command, upward — any report found on it
  // would end up managing their own manager.
  const chain = new Set<string>();
  if (toManager) {
    let cursor: ObjectId | null = toManager.managerId ?? null;
    for (let depth = 0; cursor && depth < MAX_CHAIN_DEPTH; depth += 1) {
      const key = cursor.toHexString();
      if (chain.has(key)) break;
      chain.add(key);
      const up: User | null = await users.findOne({ _id: cursor, orgId });
      cursor = up?.managerId ?? null;
    }
  }

  const moving: User[] = [];
  const skipped: ReassignReportsResult["skipped"] = [];
  for (const r of reports) {
    const id = r._id.toHexString();
    if (toManagerId && r._id.equals(toManagerId)) {
      skipped.push({ userId: id, reason: "is_new_manager" });
    } else if (chain.has(id)) {
      skipped.push({ userId: id, reason: "would_create_cycle" });
    } else {
      moving.push(r);
    }
  }

  const toManagerName = label(toManager);
  const movingIds = moving.map((u) => u._id);
  let pendingApprovals = 0;

  if (movingIds.length > 0) {
    await users.updateMany(
      { orgId, managerId: fromManagerId, _id: { $in: movingIds } },
      { $set: { managerId: toManagerId, updatedAt: now } },
    );

    const pendingFilter = {
      orgId,
      userId: { $in: movingIds },
      "spec.approval.status": "pending",
    };
    // A disabled report's pending specs are hidden by every queue — they
    // still get the routing stamp, but aren't counted or announced to the
    // new manager as work waiting on them.
    const allPending = await goalSpecs.find(pendingFilter).toArray();
    const pending = allPending.filter(
      (rec) =>
        moving.find((u) => u._id.equals(rec.userId))?.status !== "disabled",
    );
    pendingApprovals = pending.length;
    if (allPending.length > 0) {
      await goalSpecs.updateMany(
        pendingFilter,
        toManagerName
          ? { $set: { "spec.approval.managerName": toManagerName } }
          : { $unset: { "spec.approval.managerName": "" } },
      );
    }

    if (toManagerId) {
      const byId = new Map(moving.map((u) => [u._id.toHexString(), u]));
      for (const rec of pending) {
        const owner = byId.get(rec.userId.toHexString()) ?? null;
        const spec = rec.spec as Record<string, unknown> | null;
        const title =
          typeof spec?.title === "string" && spec.title ? spec.title : rec.goalId;
        void notify({
          orgId,
          userId: toManagerId,
          kind: "goal_submitted",
          title: "A goal needs your approval",
          body: `${label(owner) ?? "A report"} was moved to your team with "${title}" still waiting for approval.`.slice(0, 1_000),
          data: {
            goalId: rec.goalId,
            goalTitle: title,
            subjectUserId: rec.userId.toHexString(),
            subjectName: owner?.displayName ?? "",
            reassigned: true,
          },
          createdBy: input.actorUserId ?? null,
        });
      }
    }
  }

  const reassigned = moving.map((u) => u._id.toHexString());
  return {
    reassigned,
    skipped,
    pendingApprovals,
    toManagerName,
    audit: {
      before: {
        managerId: fromManagerId.toHexString(),
        reportIds: reassigned,
      },
      after: {
        managerId: toManagerId ? toManagerId.toHexString() : null,
        reportIds: reassigned,
        pendingApprovals,
      },
    },
  };
}
