/**
 * Route an open Build-Your-Own approval: resolve who decides it (the
 * submitter's ACTIVE manager, else the org's admins) and notify them.
 *
 * Shared by POST /goal-specs/:goalId/submit-approval (the client's explicit
 * hand-off) and by the server-enforced gate (PUT /goal-specs/:goalId and the
 * migrate import), which must route a spec it FORCED to pending itself —
 * the client that skipped the approval block will never call submit.
 */

import type { Request } from "express";
import type { ObjectId } from "mongodb";
import type { Session } from "../../db/types.js";
import { getGoalsCollection, getUsersCollection } from "../../db/collections.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { createNotification } from "../../lib/notifications.js";
import { notifyOrgAdmins } from "../../lib/admin-notify.js";
import {
  buildSubmitApprovalResponse,
  isActiveManager,
  managerLabel,
  type SubmitApprovalResponse,
} from "./approval.js";

export type ApprovalRouteSession = Pick<Session, "orgId" | "userId" | "role">;

export interface ApprovalRoute {
  response: SubmitApprovalResponse;
  managerId: ObjectId | null;
  managerName: string | null;
  routedToManager: boolean;
  submitterName: string;
}

/** Who decides this user's approvals right now. No side effects. */
export async function resolveApprovalRoute(
  session: ApprovalRouteSession,
  storedSubmittedAt?: unknown,
): Promise<ApprovalRoute> {
  const users = await getUsersCollection();
  const me = await users.findOne({ _id: session.userId, orgId: session.orgId });
  const managerId = me?.managerId ?? null;
  const manager = managerId
    ? await users.findOne(
        { _id: managerId, orgId: session.orgId },
        { projection: { displayName: 1, email: 1, status: 1 } },
      )
    : null;
  const routedToManager = managerId !== null && isActiveManager(manager);
  const managerName = routedToManager ? managerLabel(manager) : null;
  const response = buildSubmitApprovalResponse({
    managerId: routedToManager && managerId ? managerId.toHexString() : null,
    managerName,
    storedSubmittedAt,
  });
  return {
    response,
    managerId,
    managerName,
    routedToManager,
    submitterName: me?.displayName ?? "",
  };
}

/** Notify whoever `route` names that `goalId` waits on them. */
export async function notifyApprovalRoute(args: {
  req: Request | null;
  session: ApprovalRouteSession;
  goalId: string;
  route: ApprovalRoute;
}): Promise<void> {
  const { req, session, goalId, route } = args;
  const tree = await getGoalsCollection().then((c) =>
    c.findOne({ orgId: session.orgId, userId: session.userId }),
  );
  let goalTitle = "a goal";
  for (const l1 of tree?.l1s ?? []) {
    for (const l2 of l1.l2s ?? []) {
      if (l2.id === goalId) goalTitle = l2.title;
    }
  }
  const { submitterName, managerId } = route;
  const data = {
    goalId,
    goalTitle,
    subjectUserId: session.userId.toHexString(),
    subjectName: submitterName,
  };

  if (route.routedToManager && managerId) {
    void createNotification({
      orgId: session.orgId,
      userId: managerId,
      kind: "goal_submitted",
      title: "A goal needs your approval",
      body: `${submitterName || "A report"} submitted "${goalTitle}" for your approval.`,
      data,
      createdBy: session.userId,
    });
    return;
  }
  // No reader in the manager chain — the org's admins own the decision.
  // Audited so an admin can see why a queue item landed with them.
  await writeAudit({
    orgId: session.orgId,
    actorUserId: session.userId,
    actorRole: session.role,
    action: "goal_spec.approval.routed_to_admins",
    targetType: "goal_spec",
    targetId: goalId,
    after: {
      reason: managerId ? "manager_disabled" : "no_manager_on_file",
    },
    ...(req ? networkMeta(req) : {}),
  });
  void notifyOrgAdmins({
    orgId: session.orgId,
    kind: "goal_submitted",
    title: "A goal needs admin approval",
    body: `${submitterName || "Someone"} has no manager assigned, so "${goalTitle}" was sent to the org's admins for approval.`,
    data: { ...data, approverScope: "admins" },
    createdBy: session.userId,
    // In-app only — a submission is routine, not an email-worthy alert.
    inboxOnly: true,
  });
}
