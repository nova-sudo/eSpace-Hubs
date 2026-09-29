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
import {
  getGoalSpecsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { effectiveSpecDocs } from "../../lib/assigned-goals.js";
import { HttpError } from "../../middleware/error-handler.js";
import { isAssignedGoalId, validateSpec } from "@espace-devhub/shared/goal-specs";
import {
  applyComposedGate,
  hasOpenApproval,
  isActiveManager,
  managerLabel,
  resolveStoredApproval,
  withApprovalRouting,
} from "./approval.js";
import { notifyApprovalRoute, resolveApprovalRoute } from "./route-approval.js";
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

/** A shared goal's plan belongs to its creator — assignees can't change it. */
function assertNotAssigned(goalId: string): void {
  if (isAssignedGoalId(goalId)) {
    throw new HttpError(
      403,
      "assigned_goal_readonly",
      "This goal was shared with you; its plan can only be changed by the person who shared it.",
    );
  }
}

/**
 * POST /:goalId/submit-approval — a dev submits their just-composed
 * Build-Your-Own tracker (already saved with approval.status="pending")
 * for review. The gate is HARD (hub-audit §1.3): nothing is auto-approved.
 *
 *   - Active manager      → notify them; the tracker stays pending.
 *       → {status:"pending", approverScope:"manager", managerId,
 *          managerName, noManager:false, submittedAt, approval}
 *   - No manager, or the  → the tracker stays pending and is routed to the
 *     manager is disabled    org's admins, who decide it on the admin hub's
 *                            Approvals page; every active admin is notified.
 *       → {status:"pending", approverScope:"admins", managerId:null,
 *          managerName:null, noManager:true, submittedAt, approval}
 *
 * `approval` is the block the client persists onto the spec (see
 * ./approval.ts). The stored pending spec gets the routing stamped
 * best-effort here; reads re-resolve it from the CURRENT manager
 * regardless. Legacy `autoApproved` rows (pre-§1.3) are still read, never
 * written.
 *
 * The spec itself is written by the normal PUT /goal-specs path; this
 * endpoint only routes the approval + notifies.
 */
export async function submitApprovalHandler(
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
    assertNotAssigned(goalId);

    const specs = await getGoalSpecsCollection();
    const stored = await specs.findOne(
      { orgId: session.orgId, userId: session.userId, goalId },
      { projection: { "spec.approval": 1 } },
    );
    // Nothing to approve: the tracker is saved (PUT) BEFORE it is submitted.
    // Without this a stray submit notified a manager about a goal that has
    // no tracker at all.
    if (!stored) {
      throw new HttpError(
        400,
        "no_tracker",
        "Save a tracker for this goal before sending it for approval.",
      );
    }
    const storedSubmittedAt = (
      stored.spec?.approval as { submittedAt?: unknown } | undefined
    )?.submittedAt;

    const route = await resolveApprovalRoute(session, storedSubmittedAt);
    const { response, managerName } = route;
    await notifyApprovalRoute({ req, session, goalId, route });

    // Best-effort: stamp the routing onto the stored pending spec so it's on
    // the row itself, not just resolved at read time. Only while still
    // pending — never over a decision someone already made.
    {
      const set: Record<string, unknown> = {
        "spec.approval.submittedAt": response.submittedAt,
        "spec.approval.approverScope": response.approverScope,
      };
      const unset: Record<string, ""> = {};
      if (response.noManager) {
        set["spec.approval.noManager"] = true;
        unset["spec.approval.managerName"] = "";
      } else {
        unset["spec.approval.noManager"] = "";
        if (managerName) set["spec.approval.managerName"] = managerName;
      }
      await specs
        .updateOne(
          {
            orgId: session.orgId,
            userId: session.userId,
            goalId,
            "spec.approval.status": "pending",
          },
          { $set: set, $unset: unset },
        )
        .catch(() => undefined);
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
}

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
    const own = await col
      .find({ orgId: session.orgId, userId: session.userId })
      .toArray();
    // Shared goals ride along (merged at read, never stored per user) —
    // `assignedGoalIds` lets the client treat them as read-only.
    const records = await effectiveSpecDocs(session.orgId, session.userId, own);

    // Open approvals name who they're routed to — resolved from the user's
    // CURRENT manager on every read (one lookup, only when something is
    // open), so the pending card never says "your manager" when there is
    // none on file.
    let routing: { managerName: string | null; hasManager: boolean } | null = null;
    if (records.some((r) => !isAssignedGoalId(r.goalId) && hasOpenApproval(r.spec))) {
      const users = await getUsersCollection();
      const me = await users.findOne(
        { _id: session.userId, orgId: session.orgId },
        { projection: { managerId: 1 } },
      );
      const managerId = me?.managerId ?? null;
      const manager = managerId
        ? await users.findOne(
            { _id: managerId, orgId: session.orgId },
            { projection: { displayName: 1, email: 1, status: 1 } },
          )
        : null;
      // A disabled manager can't act — their reports' approvals are the
      // admins' (same rule as submit-approval).
      const hasManager = Boolean(managerId) && isActiveManager(manager);
      routing = {
        managerName: hasManager ? managerLabel(manager) : null,
        hasManager,
      };
    }

    const specs: Record<string, unknown> = {};
    const assignedGoalIds: string[] = [];
    let lastAnalyzedAt = 0;
    for (const r of records) {
      specs[r.goalId] =
        routing && !isAssignedGoalId(r.goalId)
          ? withApprovalRouting(r.spec, routing.managerName, routing.hasManager)
          : r.spec;
      if (isAssignedGoalId(r.goalId)) {
        assignedGoalIds.push(r.goalId);
        continue;
      }
      const ts = r.generatedAt.getTime();
      if (ts > lastAnalyzedAt) lastAnalyzedAt = ts;
    }
    res.json({ specs, assignedGoalIds, lastAnalyzedAt });
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
    assertNotAssigned(goalId);

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

    const now = new Date();
    const classifierVersion =
      typeof candidate.classifierVersion === "string"
        ? (candidate.classifierVersion as string).slice(0, 200)
        : null;

    const col = await getGoalSpecsCollection();

    // `approval` is server-owned (see resolveStoredApproval): the client may
    // only (re)submit — never approve, reject, or revert a decision.
    const stored = await col.findOne(
      { orgId: session.orgId, userId: session.userId, goalId },
      { projection: { "spec.approval": 1, "spec.widget": 1 } },
    );
    const resolved = resolveStoredApproval(
      stored?.spec?.approval,
      (result.spec as { approval?: unknown }).approval,
      now.getTime(),
    );
    // Hard BYO gate (see applyComposedGate for the per-flow exemptions): a
    // NEW COMPOSED tracker is stored pending whatever the body says, and —
    // because the client skipped the hand-off — routed here.
    const gate = applyComposedGate({
      widget: result.spec.widget,
      storedWidget: stored?.spec?.widget,
      storedExists: Boolean(stored),
      resolved,
      now: now.getTime(),
    });
    let approval = gate.approval;
    const forcedRoute = gate.forced ? await resolveApprovalRoute(session) : null;
    if (forcedRoute && approval) {
      approval = { ...forcedRoute.response.approval, submittedAt: approval.submittedAt };
    }
    const { approval: _clientApproval, ...withoutApproval } =
      result.spec as ValidatedSpec & { approval?: unknown };
    const spec = (
      approval ? { ...withoutApproval, approval } : withoutApproval
    ) as ValidatedSpec;

    // Compare-and-set on the approval status we resolved against, so a
    // decision landing between the read above and this write isn't
    // overwritten. A mismatch on an existing row makes the upsert collide
    // with the unique (org,user,goal) index → 409, and the client refetches.
    const storedStatus = (stored?.spec?.approval as { status?: unknown } | undefined)
      ?.status;
    let upserted;
    try {
      upserted = await col.findOneAndUpdate(
        {
          orgId: session.orgId,
          userId: session.userId,
          goalId,
          "spec.approval.status":
            typeof storedStatus === "string" ? storedStatus : { $exists: false },
        },
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
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new HttpError(
          409,
          "approval_changed",
          "This goal's approval changed while you were editing. Reload and try again.",
        );
      }
      throw err;
    }

    if (forcedRoute) {
      await notifyApprovalRoute({ req, session, goalId, route: forcedRoute });
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "goal_specs.upsert",
      targetType: "goal_spec",
      targetId: goalId,
      after: {
        widget: spec.widget,
        kind: spec.kind,
        ...(gate.forced ? { approvalForced: true } : {}),
      },
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
    assertNotAssigned(goalId);
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
