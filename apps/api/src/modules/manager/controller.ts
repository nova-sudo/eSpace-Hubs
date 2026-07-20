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
import type { ContextAnswer, User, UserRole } from "../../db/types.js";
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
    confidence: string;
    reasoning: string;
    gradedAt: string;
    source: "ai" | "manager";
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

    const [tree, specDocs, ctxDocs, verdictDocs, activity] = await Promise.all([
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
        const v = verdictMap.get(l2.id) ?? null;

        summary.total += 1;
        if (status === "needs_setup" || status === "unclassified") {
          summary.needsSetup += 1;
        }
        if (status === "auto") summary.auto += 1;
        if (status === "no_data") summary.noData += 1;
        if (status === "tracking") summary.tracking += 1;
        if (judge === "manager") summary.delegatedToYou += 1;
        if (v) {
          summary.graded += 1;
          const t = v.verdict.tier;
          if (t in summary.byTier) summary.byTier[t] += 1;
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
          tier: v
            ? {
                tier: v.verdict.tier,
                confidence: v.verdict.confidence,
                reasoning: v.verdict.reasoning,
                gradedAt: v.gradedAt.toISOString(),
                source: "ai",
              }
            : null,
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
