/**
 * The admins' Build-Your-Own approvals queue (hub-audit §1.3).
 *
 * The approval gate is hard: a submitter with no ACTIVE manager is not
 * auto-approved — the tracker stays pending with `approverScope:
 * "admins"` and lands here. Semantics mirror the manager's queue exactly
 * (same decision vocabulary, same approval block, same notifications), so
 * a dev can't tell which kind of reviewer decided except by name.
 *
 *   GET  /admin/approvals                      pending trackers whose owner
 *                                              has no active manager
 *   POST /admin/approvals/:userId/:goalId      { decision, note? }
 *
 * Routing is resolved from the owner's CURRENT manager on every read —
 * the same rule goal-specs uses — so assigning a manager moves an item
 * out of this queue and into theirs without any data migration. An item
 * whose owner has an active manager is refused here (409): that manager
 * decides it.
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  getGoalSpecsCollection,
  getGoalsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type { User } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { createNotification } from "../../lib/notifications.js";
import { HttpError } from "../../middleware/error-handler.js";
import { approvalDecisionSchema } from "./schemas.js";

interface AdminApprovalItem {
  user: { id: string; displayName: string; email: string; department: string | null };
  goal: { id: string; title: string; category: string };
  submittedAt: number | null;
  /** Why it's the admins' call. */
  reason: "no_manager" | "manager_disabled";
  cadence: string | null;
  fields: { kind: string; label: string }[];
  periods: { label: string; dueAt: string | null }[];
  tiers: Record<string, string> | null;
}

/**
 * Of `owners`, who has no manager an approval could reach? Returns the
 * reason per owner id (hex); owners with an active manager are absent.
 */
async function adminRouted(
  orgId: ObjectId,
  owners: User[],
): Promise<Map<string, AdminApprovalItem["reason"]>> {
  const managerIds = [
    ...new Set(owners.map((u) => u.managerId?.toHexString()).filter(Boolean)),
  ].map((h) => new ObjectId(h as string));
  const managers = managerIds.length
    ? await getUsersCollection().then((c) =>
        c
          .find({ orgId, _id: { $in: managerIds } }, { projection: { status: 1 } })
          .toArray(),
      )
    : [];
  const status = new Map(managers.map((m) => [m._id.toHexString(), m.status]));
  const out = new Map<string, AdminApprovalItem["reason"]>();
  for (const u of owners) {
    if (!u.managerId) {
      out.set(u._id.toHexString(), "no_manager");
      continue;
    }
    const s = status.get(u.managerId.toHexString());
    if (s === undefined) out.set(u._id.toHexString(), "no_manager");
    else if (s === "disabled") out.set(u._id.toHexString(), "manager_disabled");
  }
  return out;
}

function goalTitleIn(
  tree: { l1s?: { l2s?: { id: string; title: string; category: string }[] }[] } | null,
  goalId: string,
): { title: string; category: string } | null {
  for (const l1 of tree?.l1s ?? []) {
    for (const l2 of l1.l2s ?? []) {
      if (l2.id === goalId) return { title: l2.title, category: l2.category };
    }
  }
  return null;
}

// ─── GET /admin/approvals ────────────────────────────────────────────

/** → { items: AdminApprovalItem[] } oldest submission first. */
export async function listAdminApprovalsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const orgId = session.orgId;
    const specs = await getGoalSpecsCollection();
    const pending = await specs
      .find({ orgId, "spec.approval.status": "pending" })
      .limit(1_000)
      .toArray();
    if (pending.length === 0) {
      res.json({ items: [] });
      return;
    }

    const ownerIds = [...new Set(pending.map((p) => p.userId.toHexString()))].map(
      (h) => new ObjectId(h),
    );
    const users = await getUsersCollection();
    const owners = await users
      .find({ orgId, _id: { $in: ownerIds }, status: { $ne: "disabled" } })
      .toArray();
    const routed = await adminRouted(orgId, owners);
    const ownerMap = new Map(owners.map((u) => [u._id.toHexString(), u]));

    const trees = await getGoalsCollection().then((c) =>
      c
        .find({ orgId, userId: { $in: owners.map((o) => o._id) } })
        .toArray(),
    );
    const treeByUser = new Map(trees.map((t) => [t.userId.toHexString(), t]));

    const items: AdminApprovalItem[] = [];
    for (const s of pending) {
      const uid = s.userId.toHexString();
      const reason = routed.get(uid);
      const user = ownerMap.get(uid);
      if (!reason || !user) continue;
      const meta = goalTitleIn(treeByUser.get(uid) ?? null, s.goalId);
      if (!meta) continue; // a spec whose goal was deleted — nothing to approve
      const spec = s.spec as Record<string, unknown>;
      const approval = spec.approval as { submittedAt?: unknown } | undefined;
      const composed = spec.composed as { cadence?: unknown; periods?: unknown } | undefined;
      const periods = (Array.isArray(composed?.periods) ? composed.periods : [])
        .map((p) => {
          const o = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
          return {
            label: typeof o.label === "string" ? o.label.slice(0, 160) : "",
            dueAt: typeof o.dueAt === "string" ? o.dueAt : null,
          };
        })
        .filter((p) => p.label)
        .slice(0, 53);
      const fields = (Array.isArray(spec.fields) ? spec.fields : [])
        .map((f) => {
          const o = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
          return {
            kind: typeof o.kind === "string" ? o.kind : "",
            label: typeof o.label === "string" ? o.label : "",
          };
        })
        .slice(0, 10);
      const tiersObj =
        spec.tiers && typeof spec.tiers === "object"
          ? (spec.tiers as Record<string, unknown>)
          : null;
      items.push({
        user: {
          id: uid,
          displayName: user.displayName,
          email: user.email,
          department: user.department ?? null,
        },
        goal: { id: s.goalId, title: meta.title, category: meta.category },
        submittedAt:
          typeof approval?.submittedAt === "number" ? approval.submittedAt : null,
        reason,
        cadence: typeof composed?.cadence === "string" ? composed.cadence : null,
        fields,
        periods,
        tiers: tiersObj
          ? (Object.fromEntries(
              Object.entries(tiersObj).filter(([, v]) => typeof v === "string"),
            ) as Record<string, string>)
          : null,
      });
    }
    items.sort(
      (a, b) =>
        (a.submittedAt ?? 0) - (b.submittedAt ?? 0) ||
        a.user.displayName.localeCompare(b.user.displayName),
    );
    res.json({ items });
  } catch (err) {
    next(err);
  }
}

// ─── POST /admin/approvals/:userId/:goalId ───────────────────────────

/**
 * Body: { decision: "approve" | "request_changes", note? }
 * → { ok: true, status: "approved" | "rejected" }
 *
 * 404 unknown user/goal in this org · 409 `has_manager` (their manager
 * decides) · 409 `not_pending` (already decided / withdrawn).
 */
export async function decideAdminApprovalHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { userId, goalId } = req.params as { userId?: string; goalId?: string };
    if (typeof userId !== "string" || !/^[0-9a-f]{24}$/i.test(userId)) {
      throw new HttpError(404, "not_found", "No such person in this org.");
    }
    if (typeof goalId !== "string" || !goalId || goalId.length > 200) {
      throw new HttpError(400, "validation_error", "Invalid goalId.");
    }
    const body = approvalDecisionSchema.parse(req.body ?? {});
    const approved = body.decision === "approve";
    const note = (body.note ?? "").trim();

    const users = await getUsersCollection();
    const owner = await users.findOne({
      _id: new ObjectId(userId),
      orgId: session.orgId,
    });
    if (!owner) {
      throw new HttpError(404, "not_found", "No such person in this org.");
    }
    const routed = await adminRouted(session.orgId, [owner]);
    if (!routed.has(userId.toLowerCase()) && !routed.has(owner._id.toHexString())) {
      throw new HttpError(
        409,
        "has_manager",
        `${owner.displayName || owner.email} has an active manager — they decide this approval.`,
      );
    }

    const specs = await getGoalSpecsCollection();
    const doc = await specs.findOne({
      orgId: session.orgId,
      userId: owner._id,
      goalId,
    });
    if (!doc) {
      throw new HttpError(404, "not_found", "No such goal for this person.");
    }
    const existing = (doc.spec.approval as { status?: unknown; submittedAt?: unknown } | undefined) ?? {};
    if (existing.status !== "pending") {
      throw new HttpError(409, "not_pending", "This goal isn't waiting for approval any more.");
    }

    const admin = await users.findOne(
      { _id: session.userId, orgId: session.orgId },
      { projection: { displayName: 1, email: 1 } },
    );
    const adminName = admin?.displayName || admin?.email || "An admin";

    const approval: Record<string, unknown> = {
      status: approved ? "approved" : "rejected",
      reviewedBy: session.userId.toHexString(),
      reviewedByName: adminName,
      reviewedAt: Date.now(),
      approverScope: "admins",
    };
    if (typeof existing.submittedAt === "number") approval.submittedAt = existing.submittedAt;
    if (note) approval.note = note.slice(0, 2_000);

    // Conditional on still-pending so two admins deciding at once can't
    // both win.
    const upd = await specs.updateOne(
      {
        orgId: session.orgId,
        userId: owner._id,
        goalId,
        "spec.approval.status": "pending",
      },
      { $set: { "spec.approval": approval } },
    );
    if (upd.matchedCount === 0) {
      throw new HttpError(409, "not_pending", "This goal isn't waiting for approval any more.");
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "admin.goal_approval.decide",
      targetType: "goal_spec",
      targetId: goalId,
      after: {
        subjectUserId: owner._id.toHexString(),
        decision: body.decision,
        hasNote: note.length > 0,
        reason: routed.get(owner._id.toHexString()) ?? null,
      },
      ...networkMeta(req),
    });

    const tree = await getGoalsCollection().then((c) =>
      c.findOne({ orgId: session.orgId, userId: owner._id }),
    );
    const goalTitle = goalTitleIn(tree, goalId)?.title ?? "your goal";
    void createNotification({
      orgId: session.orgId,
      userId: owner._id,
      kind: approved ? "goal_approved" : "goal_changes_requested",
      title: approved ? "Your goal was approved" : "An admin requested changes",
      body: approved
        ? `${adminName} (admin) approved "${goalTitle}" — it's live now.`
        : `${adminName} (admin) asked for changes to "${goalTitle}" before it goes live.`,
      data: { goalId, goalTitle, decision: body.decision, note, approverScope: "admins" },
      createdBy: session.userId,
    });

    res.json({ ok: true, status: approval.status });
  } catch (err) {
    next(err);
  }
}
