/**
 * Manager controller — a manager's read surface over their direct
 * reports. Every query is scoped to `managerId === session.userId`
 * inside the session's org, so a manager only ever sees the people who
 * report to them (never the whole org — that's admin's job).
 *
 *   GET /api/v1/manager/reports                      list direct reports
 *   GET /api/v1/manager/reports/:userId/goal-health  one report's board
 *
 * Gated by `requireCapability(manager.team.view)` in routes.ts; the
 * controllers assume that passed and apply the managerId + orgId
 * boundary. Grading, delegated verdicts, approvals, and notifications
 * land in later drops — see docs/manager-hub-plan.md.
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  getGoalContextCollection,
  getGoalInputsCollection,
  getGoalSpecsCollection,
  getGoalTierVerdictsCollection,
  getGoalsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type {
  ContextAnswer,
  GoalTier,
  User,
  UserRole,
} from "../../db/types.js";
import {
  getManagerVerdictMap,
  listManagerVerdictsForSubjects,
  upsertManagerVerdict,
} from "../../lib/manager-verdicts.js";
import { createNotification } from "../../lib/notifications.js";
import { primaryRole } from "../../lib/user-roles.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  contextComplete,
  delegatedJudge,
  deriveStatus,
  goalReadiness,
  specKindLabel,
  specVariant,
  type GoalStatus,
} from "./goal-health.js";

/**
 * What a manager sees per direct report on the roster. Deliberately thin
 * — identity + org-chart context only, no secrets, no performance data
 * (that's the goal-health endpoint).
 */
interface ReportCard {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  department: string | null;
  level: string | null;
}

function toReportCard(u: User): ReportCard {
  return {
    id: u._id.toHexString(),
    displayName: u.displayName,
    email: u.email,
    role: primaryRole(u),
    department: u.department ?? null,
    level: u.level ?? null,
  };
}

export async function listReportsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }

    const users = await getUsersCollection();
    const docs = await users
      .find({
        orgId: session.orgId,
        managerId: session.userId,
        status: { $ne: "disabled" },
      })
      .sort({ displayName: 1 })
      .toArray();

    res.json({ reports: docs.map(toReportCard) });
  } catch (err) {
    next(err);
  }
}

// ─── one report's goal board ─────────────────────────────────────────

interface GoalRow {
  id: string;
  code: string;
  title: string;
  category: string;
  status: GoalStatus;
  readiness: string;
  kindLabel: string | null;
  variant: string | null;
  delegatedJudge: string | null;
  entryCount: number;
  lastActivityAt: string | null;
  tier: {
    tier: string;
    confidence: string | null;
    reasoning: string;
    gradedAt: string;
    source: "ai" | "manager";
    gradedByName: string | null;
  } | null;
}

interface GoalGroup {
  l1: {
    id: string;
    code: string;
    title: string;
    category: string;
    weightage: number;
  };
  goals: GoalRow[];
}

/**
 * Resolve the target report and enforce the manager boundary. Returns
 * the user doc, or throws 404 when the id is malformed, the user isn't
 * in this org, or they don't report to the caller. 404 (not 403) so the
 * endpoint never reveals whether an arbitrary user id exists.
 */
async function resolveReport(
  req: Request,
): Promise<{ session: NonNullable<Request["session"]>; target: User }> {
  const session = req.session;
  if (!session) {
    throw new HttpError(401, "unauthenticated", "Login required.");
  }
  const rawId = req.params.userId;
  if (!ObjectId.isValid(rawId)) {
    throw new HttpError(404, "not_found", "That teammate isn't on your team.");
  }
  const users = await getUsersCollection();
  const target = await users.findOne({
    _id: new ObjectId(rawId),
    orgId: session.orgId,
  });
  if (!target || !target.managerId || !target.managerId.equals(session.userId)) {
    throw new HttpError(404, "not_found", "That teammate isn't on your team.");
  }
  return { session, target };
}

export async function getReportGoalHealthHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { session, target } = await resolveReport(req);
    const scope = { orgId: session.orgId, userId: target._id };

    const [tree, specDocs, ctxDocs, verdictDocs, activity, managerVerdictMap] =
      await Promise.all([
        getGoalsCollection().then((c) => c.findOne(scope)),
        getGoalSpecsCollection().then((c) => c.find(scope).toArray()),
        getGoalContextCollection().then((c) => c.find(scope).toArray()),
        getGoalTierVerdictsCollection().then((c) => c.find(scope).toArray()),
        getGoalInputsCollection().then((c) =>
          c
            .aggregate<{ _id: string; count: number; lastTs: Date }>([
              { $match: scope },
              {
                $group: {
                  _id: "$goalId",
                  count: { $sum: 1 },
                  lastTs: { $max: "$ts" },
                },
              },
            ])
            .toArray(),
        ),
        getManagerVerdictMap(session.orgId, target._id),
      ]);

    const specMap = new Map(specDocs.map((s) => [s.goalId, s.spec]));
    const ctxMap = new Map<string, Record<string, ContextAnswer>>(
      ctxDocs.map((c) => [c.goalId, c.answers]),
    );
    const verdictMap = new Map(verdictDocs.map((v) => [v.goalId, v]));
    const activityMap = new Map(activity.map((a) => [a._id, a]));

    const summary = {
      total: 0,
      graded: 0,
      needsSetup: 0,
      delegatedToYou: 0,
      noData: 0,
      auto: 0,
      tracking: 0,
      byTier: { not_achieved: 0, achieved: 0, over_achieved: 0, role_model: 0 },
    };

    const groups: GoalGroup[] = (tree?.l1s ?? []).map((l1) => ({
      l1: {
        id: l1.id,
        code: l1.code,
        title: l1.title,
        category: l1.category,
        weightage: l1.weightage,
      },
      goals: (l1.l2s ?? []).map((l2): GoalRow => {
        const spec = specMap.get(l2.id) ?? null;
        const answers = ctxMap.get(l2.id) ?? {};
        const readiness = goalReadiness(spec, contextComplete(spec, answers));
        const variant = specVariant(spec);
        const act = activityMap.get(l2.id) ?? null;
        const entryCount = act?.count ?? 0;
        const status = deriveStatus(readiness, variant, entryCount > 0);
        const judge = delegatedJudge(spec);
        const mv = managerVerdictMap.get(l2.id) ?? null;
        const aiv = verdictMap.get(l2.id) ?? null;
        // Manager verdict wins over the AI cache wherever a tier shows.
        const tierOut = mv
          ? {
              tier: mv.tier,
              confidence: null,
              reasoning: mv.note,
              gradedAt: mv.gradedAt.toISOString(),
              source: "manager" as const,
              gradedByName: mv.gradedByName,
            }
          : aiv
            ? {
                tier: aiv.verdict.tier,
                confidence: aiv.verdict.confidence,
                reasoning: aiv.verdict.reasoning,
                gradedAt: aiv.gradedAt.toISOString(),
                source: "ai" as const,
                gradedByName: null,
              }
            : null;

        summary.total += 1;
        if (status === "needs_setup" || status === "unclassified") {
          summary.needsSetup += 1;
        }
        if (status === "auto") summary.auto += 1;
        if (status === "no_data") summary.noData += 1;
        if (status === "tracking") summary.tracking += 1;
        if (judge === "manager") summary.delegatedToYou += 1;
        if (tierOut) {
          summary.graded += 1;
          summary.byTier[tierOut.tier] += 1;
        }

        return {
          id: l2.id,
          code: l2.code,
          title: l2.title,
          category: l2.category,
          status,
          readiness,
          kindLabel: specKindLabel(spec),
          variant,
          delegatedJudge: judge,
          entryCount,
          lastActivityAt: act?.lastTs ? act.lastTs.toISOString() : null,
          tier: tierOut,
        };
      }),
    }));

    res.json({
      user: toReportCard(target),
      summary,
      groups,
    });
  } catch (err) {
    next(err);
  }
}

// ─── grade a report's goal (manager-authored tier verdict) ───────────

const TIERS: readonly GoalTier[] = [
  "not_achieved",
  "achieved",
  "over_achieved",
  "role_model",
];

const TIER_LABEL: Record<GoalTier, string> = {
  not_achieved: "Not achieved",
  achieved: "Achieved",
  over_achieved: "Over achieved",
  role_model: "Role model",
};

/** Map every L2 goal id in a report's tree → its title. */
function goalTitleMap(
  tree: { l1s?: { l2s?: { id: string; title: string }[] }[] } | null,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const l1 of tree?.l1s ?? []) {
    for (const l2 of l1.l2s ?? []) map.set(l2.id, l2.title);
  }
  return map;
}

export async function putGoalVerdictHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { session, target } = await resolveReport(req);
    const goalId = req.params.goalId;

    const body = (req.body ?? {}) as { tier?: unknown; note?: unknown };
    if (typeof body.tier !== "string" || !TIERS.includes(body.tier as GoalTier)) {
      throw new HttpError(
        400,
        "invalid_tier",
        "Pick one of the four achievement tiers.",
      );
    }
    const tier = body.tier as GoalTier;
    const note = typeof body.note === "string" ? body.note.slice(0, 4_000) : "";

    // The goal must exist in this report's tree — no orphan verdicts.
    const tree = await getGoalsCollection().then((c) =>
      c.findOne({ orgId: session.orgId, userId: target._id }),
    );
    const titles = goalTitleMap(tree);
    if (!titles.has(goalId)) {
      throw new HttpError(404, "not_found", "No such goal for this report.");
    }
    const goalTitle = titles.get(goalId) ?? "a goal";

    // The manager's display name, denormalised onto the verdict + notice.
    const manager = await getUsersCollection().then((c) =>
      c.findOne({ _id: session.userId, orgId: session.orgId }),
    );
    const managerName = manager?.displayName ?? "Your manager";

    await upsertManagerVerdict({
      orgId: session.orgId,
      subjectUserId: target._id,
      goalId,
      tier,
      note,
      gradedBy: session.userId,
      gradedByName: managerName,
    });

    // Best-effort inbox notice — must never block the grade itself.
    void createNotification({
      orgId: session.orgId,
      userId: target._id,
      kind: "manager_graded",
      title: "Your manager graded a goal",
      body: `${managerName} set "${goalTitle}" to ${TIER_LABEL[tier]}.`,
      data: { goalId, tier, goalTitle, gradedByName: managerName, note },
      createdBy: session.userId,
    });

    res.json({
      ok: true,
      verdict: {
        goalId,
        tier,
        note,
        gradedByName: managerName,
        source: "manager",
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── delegated queue (goals across all reports awaiting your verdict) ─

interface DelegatedItem {
  user: {
    id: string;
    displayName: string;
    role: UserRole;
    department: string | null;
  };
  goal: { id: string; title: string; category: string };
  kindLabel: string | null;
  note: string;
  verdict: { tier: string; gradedAt: string; gradedByName: string } | null;
}

export async function listDelegatedQueueHandler(
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

    const users = await getUsersCollection();
    const reports = await users
      .find({ orgId, managerId: session.userId, status: { $ne: "disabled" } })
      .toArray();
    if (reports.length === 0) {
      res.json({ items: [] });
      return;
    }
    const reportIds = reports.map((u) => u._id);
    const reportMap = new Map(reports.map((u) => [u._id.toHexString(), u]));

    const [specDocs, treeDocs, verdictDocs] = await Promise.all([
      getGoalSpecsCollection().then((c) =>
        c
          .find({
            orgId,
            userId: { $in: reportIds },
            "spec.delegated.delegated": true,
            "spec.delegated.judge": "manager",
          })
          .toArray(),
      ),
      getGoalsCollection().then((c) =>
        c.find({ orgId, userId: { $in: reportIds } }).toArray(),
      ),
      listManagerVerdictsForSubjects(orgId, reportIds),
    ]);

    // (userId:goalId) → goal title/category, from each report's tree.
    const goalMeta = new Map<string, { title: string; category: string }>();
    for (const t of treeDocs) {
      const uid = t.userId.toHexString();
      for (const l1 of t.l1s ?? []) {
        for (const l2 of l1.l2s ?? []) {
          goalMeta.set(`${uid}:${l2.id}`, {
            title: l2.title,
            category: l2.category,
          });
        }
      }
    }
    const verdictMap = new Map(
      verdictDocs.map((v) => [`${v.subjectUserId.toHexString()}:${v.goalId}`, v]),
    );

    const items: DelegatedItem[] = [];
    for (const s of specDocs) {
      const uid = s.userId.toHexString();
      const user = reportMap.get(uid);
      const meta = goalMeta.get(`${uid}:${s.goalId}`);
      if (!user || !meta) continue; // orphan spec (goal removed)
      const dnote = (s.spec.delegated as { note?: unknown } | null | undefined)
        ?.note;
      const v = verdictMap.get(`${uid}:${s.goalId}`) ?? null;
      items.push({
        user: {
          id: uid,
          displayName: user.displayName,
          role: primaryRole(user),
          department: user.department ?? null,
        },
        goal: { id: s.goalId, title: meta.title, category: meta.category },
        kindLabel: specKindLabel(s.spec),
        note: typeof dnote === "string" ? dnote : "",
        verdict: v
          ? {
              tier: v.tier,
              gradedAt: v.gradedAt.toISOString(),
              gradedByName: v.gradedByName,
            }
          : null,
      });
    }

    // Ungraded first (need your call), then by engineer, then goal.
    items.sort((a, b) => {
      const av = a.verdict ? 1 : 0;
      const bv = b.verdict ? 1 : 0;
      if (av !== bv) return av - bv;
      const n = a.user.displayName.localeCompare(b.user.displayName);
      return n !== 0 ? n : a.goal.title.localeCompare(b.goal.title);
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
}

// ─── BYO approvals (Build-Your-Own trackers pending your approval) ────

interface ApprovalItem {
  user: {
    id: string;
    displayName: string;
    role: UserRole;
    department: string | null;
  };
  goal: { id: string; title: string; category: string };
  submittedAt: number | null;
  cadence: string | null;
  fields: { kind: string; label: string }[];
  tiers: Record<string, string> | null;
}

export async function listApprovalsHandler(
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

    const users = await getUsersCollection();
    const reports = await users
      .find({ orgId, managerId: session.userId, status: { $ne: "disabled" } })
      .toArray();
    if (reports.length === 0) {
      res.json({ items: [] });
      return;
    }
    const reportIds = reports.map((u) => u._id);
    const reportMap = new Map(reports.map((u) => [u._id.toHexString(), u]));

    const [specDocs, treeDocs] = await Promise.all([
      getGoalSpecsCollection().then((c) =>
        c
          .find({
            orgId,
            userId: { $in: reportIds },
            "spec.approval.status": "pending",
          })
          .toArray(),
      ),
      getGoalsCollection().then((c) =>
        c.find({ orgId, userId: { $in: reportIds } }).toArray(),
      ),
    ]);

    const goalMeta = new Map<string, { title: string; category: string }>();
    for (const t of treeDocs) {
      const uid = t.userId.toHexString();
      for (const l1 of t.l1s ?? []) {
        for (const l2 of l1.l2s ?? []) {
          goalMeta.set(`${uid}:${l2.id}`, {
            title: l2.title,
            category: l2.category,
          });
        }
      }
    }

    const items: ApprovalItem[] = [];
    for (const s of specDocs) {
      const uid = s.userId.toHexString();
      const user = reportMap.get(uid);
      const meta = goalMeta.get(`${uid}:${s.goalId}`);
      if (!user || !meta) continue;
      const spec = s.spec;
      const approval = spec.approval as { submittedAt?: unknown } | undefined;
      const composed = spec.composed as { cadence?: unknown } | undefined;
      const rawFields = Array.isArray(spec.fields) ? spec.fields : [];
      const fields = rawFields
        .map((f) => {
          const o =
            f && typeof f === "object" ? (f as Record<string, unknown>) : {};
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
      const tiers = tiersObj
        ? (Object.fromEntries(
            Object.entries(tiersObj).filter(([, v]) => typeof v === "string"),
          ) as Record<string, string>)
        : null;

      items.push({
        user: {
          id: uid,
          displayName: user.displayName,
          role: primaryRole(user),
          department: user.department ?? null,
        },
        goal: { id: s.goalId, title: meta.title, category: meta.category },
        submittedAt:
          typeof approval?.submittedAt === "number"
            ? approval.submittedAt
            : null,
        cadence: typeof composed?.cadence === "string" ? composed.cadence : null,
        fields,
        tiers,
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

export async function putApprovalDecisionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { session, target } = await resolveReport(req);
    const goalId = req.params.goalId;

    const body = (req.body ?? {}) as { decision?: unknown; note?: unknown };
    if (body.decision !== "approve" && body.decision !== "request_changes") {
      throw new HttpError(
        400,
        "invalid_decision",
        "Decision must be approve or request_changes.",
      );
    }
    const approved = body.decision === "approve";
    const note = typeof body.note === "string" ? body.note.slice(0, 2_000) : "";

    const specs = await getGoalSpecsCollection();
    const doc = await specs.findOne({
      orgId: session.orgId,
      userId: target._id,
      goalId,
    });
    if (!doc) {
      throw new HttpError(404, "not_found", "No such goal for this report.");
    }
    const existing =
      (doc.spec.approval as { submittedAt?: unknown } | undefined) ?? {};

    const manager = await getUsersCollection().then((c) =>
      c.findOne({ _id: session.userId, orgId: session.orgId }),
    );
    const managerName = manager?.displayName ?? "Your manager";

    const approval: Record<string, unknown> = {
      status: approved ? "approved" : "rejected",
      reviewedBy: session.userId.toHexString(),
      reviewedByName: managerName,
      reviewedAt: Date.now(),
    };
    if (typeof existing.submittedAt === "number") {
      approval.submittedAt = existing.submittedAt;
    }
    if (note) approval.note = note;

    await specs.updateOne(
      { orgId: session.orgId, userId: target._id, goalId },
      { $set: { "spec.approval": approval } },
    );

    const tree = await getGoalsCollection().then((c) =>
      c.findOne({ orgId: session.orgId, userId: target._id }),
    );
    const goalTitle = goalTitleMap(tree).get(goalId) ?? "your goal";

    void createNotification({
      orgId: session.orgId,
      userId: target._id,
      kind: approved ? "goal_approved" : "goal_changes_requested",
      title: approved
        ? "Your goal was approved"
        : "Your manager requested changes",
      body: approved
        ? `${managerName} approved "${goalTitle}" — it's live now.`
        : `${managerName} asked for changes to "${goalTitle}" before it goes live.`,
      data: { goalId, goalTitle, decision: body.decision, note },
      createdBy: session.userId,
    });

    res.json({ ok: true, status: approval.status });
  } catch (err) {
    next(err);
  }
}
