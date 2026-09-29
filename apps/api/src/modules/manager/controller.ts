/**
 * Manager controller — a manager's read surface over their direct
 * reports. Every query is scoped to `managerId === session.userId`
 * inside the session's org, so a manager only ever sees the people who
 * report to them (never the whole org — that's admin's job).
 *
 * See routes.ts for the endpoint list.
 *
 * Gated by `requireCapability(manager.team.view)` in routes.ts; the
 * controllers assume that passed and apply the managerId + orgId
 * boundary (./resolve-report.ts). Every mutation writes an audit row.
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import {
  assignedSpecRecordFor,
  effectiveSpecDocs,
  withAssignedTree,
} from "../../lib/assigned-goals.js";
import {
  assignedGoalId,
  isAssignedGoalId,
  GOAL_STATUS as SHARED_STATUS,
  SEVERITY as SHARED_SEVERITY,
  isMeasurable as sharedIsMeasurable,
  isSingleRecordWidget,
  specCadence,
} from "@espace-devhub/shared/goal-specs";
import {
  getAssignedGoalsCollection,
  getGoalContextCollection,
  getGoalInputsCollection,
  getGoalLocksCollection,
  getGoalSpecsCollection,
  getNotificationsCollection,
  getGoalTierVerdictsCollection,
  getGoalsCollection,
  getReviewPacketsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type {
  ContextAnswer,
  GoalTier,
  TierCriteria,
  User,
  UserRole,
  GoalSpecRecord,
} from "../../db/types.js";
import { WHOLE_GOAL_TIER_KEY } from "../../db/types.js";
import {
  ackToJson,
  currentVerdictToJson,
  getManagerVerdictMap,
  isAcceptablePeriodKey,
  PERIOD_YEAR_WINDOW,
  listManagerVerdictHistory,
  listManagerVerdictsForSubjects,
  recordManagerVerdict,
} from "../../lib/manager-verdicts.js";
import {
  currentCycleKey,
  deleteTierPolicy,
  listTierPolicies,
  upsertTierPolicy,
} from "../../lib/goal-tier-policies.js";
import { createNotification } from "../../lib/notifications.js";
import { primaryRole } from "../../lib/user-roles.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  contextComplete,
  delegatedJudge,
  deriveStatus,
  goalReadiness,
  specKindLabel,
  sharedGoalStatus,
  specVariant,
  type GoalStatusKey,
} from "./goal-health.js";
import { buildGoalDetail } from "./goal-detail.js";
import { resolveReportFor } from "./resolve-report.js";
import {
  findGovernedGoal,
  tierPolicyNotificationData,
  type GovernedGoal,
  type TierPolicyChange,
} from "./tier-policy-notify.js";
import * as sharedGoalSpecs from "@espace-devhub/shared/goal-specs";

/**
 * The query-template registry, reached structurally. The approval projection
 * is the only thing here that needs it, and it must never be the reason this
 * endpoint 500s: if the registry isn't reachable the approval card simply
 * loses one description line, which is a far better failure than a manager
 * unable to see their queue at all.
 */
const queryRegistry = sharedGoalSpecs as unknown as {
  describeQuerySource?: (source: unknown) => string;
};

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
  /** The shared status key (goal-status.js) — same word the dev sees. */
  status: GoalStatusKey;
  statusLabel: string;
  statusTone: string;
  statusReason: string | null;
  /** Due-so-far windows: logged (or settled) vs due. Null when not windowed. */
  logged: { done: number; due: number; owed: number } | null;
  /** The cadence the windows bucket on ("weekly"…), for "4 of 6 weeks". */
  cadence: string | null;
  readiness: string;
  kindLabel: string | null;
  variant: string | null;
  delegatedJudge: string | null;
  entryCount: number;
  lastActivityAt: string | null;
  /** Headline reading frozen in the report's latest review packet
   *  ("41 merged PRs"), or null. The only number the server has for
   *  AUTO goals — provider metrics are computed client-side (#238). */
  reading: string | null;
  readingAsOf: string | null;
  tier: {
    tier: string;
    confidence: string | null;
    reasoning: string;
    gradedAt: string;
    source: "ai" | "manager";
    gradedByName: string | null;
    /** The report's acknowledgement of a MANAGER grade; null otherwise. */
    ack?: { at: string; disagree: boolean; note: string } | null;
  } | null;
  /**
   * The AI's tier, ALWAYS — `tier` above collapses to the manager
   * verdict once one exists, which makes the two impossible to compare.
   * The manager board's consistency table grades a person's goals
   * against each other by the delta between these two, so the AI's rung
   * has to survive being overridden.
   */
  aiTier: string | null;
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
 * Resolve the target report and enforce the manager boundary — see
 * ./resolve-report.ts (unit-tested) for the rules. 404 (not 403) so the
 * endpoint never reveals whether an arbitrary user id exists.
 */
async function resolveReport(
  req: Request,
): Promise<{ session: NonNullable<Request["session"]>; target: User }> {
  const users = await getUsersCollection();
  const target = await resolveReportFor(req.session, req.params.userId, (q) =>
    users.findOne(q),
  );
  return { session: req.session!, target };
}

/**
 * One report's full board — extracted so the team summary can compute it
 * server-side for every report in one request instead of the browser
 * fanning out N goal-health calls (#238).
 */
async function computeGoalHealth(orgId: ObjectId, target: User, viewerId?: ObjectId) {
  {
    const scope = { orgId, userId: target._id };

    const [tree, specDocs, ctxDocs, verdictDocs, activity, managerVerdictMap] =
      await Promise.all([
        // Shared goals assigned to this report ride along, so their line
        // manager sees (and can grade) them on the board.
        getGoalsCollection()
          .then((c) => c.findOne(scope))
          .then((t) => withAssignedTree(orgId, target._id, t)),
        getGoalSpecsCollection()
          .then((c) => c.find(scope).toArray())
          .then(
            async (docs) =>
              (await effectiveSpecDocs(orgId, target._id, docs)) as typeof docs,
          ),
        getGoalContextCollection().then((c) => c.find(scope).toArray()),
        // Whole-goal verdicts only — per-window verdicts (a single quarter
        // graded on its own) now live in this same collection, and a manager
        // summary needs the pooled, whole-goal one, not an arbitrary window's.
        // `$exists: false` also matches rows written before per-window
        // grading existed, which never got a periodKey at all.
        getGoalTierVerdictsCollection().then((c) =>
          c
            .find({
              ...scope,
              $or: [
                { periodKey: WHOLE_GOAL_TIER_KEY },
                { periodKey: { $exists: false } },
              ],
            })
            .toArray(),
        ),
        getGoalInputsCollection().then((c) =>
          c
            .aggregate<{
              _id: string;
              count: number;
              lastTs: Date;
              tss: Array<Date | number>;
              firstId: ObjectId;
            }>([
              { $match: scope },
              {
                $group: {
                  _id: "$goalId",
                  count: { $sum: 1 },
                  lastTs: { $max: "$ts" },
                  // Every entry's time — the cadence windows need them to
                  // say which weeks were logged (the shared status model).
                  tss: { $push: "$ts" },
                  firstId: { $min: "$_id" },
                },
              },
            ])
            .toArray(),
        ),
        getManagerVerdictMap(orgId, target._id),
      ]);
    // Facts the shared window model needs beyond the rows above: the
    // report's settle locks ("nothing to report" weeks) and when each
    // tracker started counting — the SAME rule as /goal-spec-meta (row
    // creation, earliest entry, assignment date, approval decision).
    const [lockDoc, assignedDocs, rawSpecRows] = await Promise.all([
      getGoalLocksCollection().then((c) => c.findOne(scope, { projection: { keys: 1 } })),
      getAssignedGoalsCollection().then((c) =>
        c
          .find({ orgId, assigneeIds: target._id }, { projection: { _id: 1, createdAt: 1 } })
          .toArray(),
      ),
      getGoalSpecsCollection().then((c) =>
        c.find(scope, { projection: { _id: 1, goalId: 1, "spec.approval": 1 } }).toArray(),
      ),
    ]);
    const locksByGoal = new Map<string, Set<string>>();
    for (const k of lockDoc?.keys ?? []) {
      const i = k.indexOf("::");
      if (i <= 0) continue;
      const gid = k.slice(0, i);
      if (!locksByGoal.has(gid)) locksByGoal.set(gid, new Set());
      locksByGoal.get(gid)!.add(k.slice(i + 2));
    }
    const trackerStart = new Map<string, Date>();
    const earliest = (id: string, at: Date) => {
      const cur = trackerStart.get(id);
      if (!cur || at.getTime() < cur.getTime()) trackerStart.set(id, at);
    };
    for (const r of rawSpecRows) earliest(r.goalId, r._id.getTimestamp());
    for (const d of assignedDocs) {
      earliest(
        assignedGoalId(d._id.toHexString()),
        d.createdAt instanceof Date ? d.createdAt : d._id.getTimestamp(),
      );
    }
    for (const a of activity) {
      if (trackerStart.has(a._id) && a.firstId) earliest(a._id, a.firstId.getTimestamp());
    }
    for (const r of rawSpecRows) {
      const approval = (r.spec as { approval?: { status?: unknown; reviewedAt?: unknown } } | undefined)
        ?.approval;
      const ms =
        typeof approval?.reviewedAt === "number"
          ? approval.reviewedAt
          : typeof approval?.reviewedAt === "string"
            ? Date.parse(approval.reviewedAt)
            : NaN;
      if (approval?.status === "approved" && Number.isFinite(ms) && ms > 0) {
        const cur = trackerStart.get(r.goalId);
        if (!cur || ms > cur.getTime()) trackerStart.set(r.goalId, new Date(ms));
      }
    }
    const hireDate = target.hireDate instanceof Date ? target.hireDate : null;
    const now = Date.now();
    // Latest review packet: the one server-side source of a real number
    // for AUTO goals (the dev's client froze it at submit time).
    const latestPacket = await getReviewPacketsCollection().then((c) =>
      c.findOne(scope, { sort: { submittedAt: -1 }, projection: { _id: 1, goals: 1, submittedAt: 1 } }),
    );
    const readingMap = new Map(
      (latestPacket?.goals ?? []).map((g) => [g.goalId, g.reading]),
    );
    const readingAsOf = latestPacket?.submittedAt.toISOString() ?? null;

    const specMap = new Map(specDocs.map((s) => [s.goalId, s.spec]));
    const ctxMap = new Map<string, Record<string, ContextAnswer>>(
      ctxDocs.map((c) => [c.goalId, c.answers]),
    );
    const verdictMap = new Map(verdictDocs.map((v) => [v.goalId, v]));
    const activityMap = new Map(activity.map((a) => [a._id, a]));

    const summary = {
      total: 0,
      graded: 0,
      /** Trackers that exist but can't be logged yet (shared "Needs setup"). */
      needsSetup: 0,
      /** Goals with no tracker at all (shared "No tracker yet"). */
      noTracker: 0,
      delegatedToYou: 0,
      noData: 0,
      auto: 0,
      tracking: 0,
      /** Per shared status key — the same buckets the dev's pages count. */
      byStatus: {} as Record<string, number>,
      /** The report's weakest measured goal, with its reason. */
      worst: null as null | {
        status: string;
        label: string;
        tone: string;
        reason: string | null;
        goalTitle: string;
      },
      /** Newest entry across every goal — "last check-in". */
      lastEntryAt: null as string | null,
      /** Manager grades the report has disagreed with (not yet regraded). */
      openDisputes: 0,
      byTier: { not_achieved: 0, achieved: 0, over_achieved: 0, role_model: 0 },
    };
    const worstRank = (k: string) => {
      const i = SHARED_SEVERITY.indexOf(k as (typeof SHARED_SEVERITY)[number]);
      // Unmeasured states never outrank a measured one for "who needs you".
      return sharedIsMeasurable(k) ? i : SHARED_SEVERITY.length + (i < 0 ? 0 : i);
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
        const legacyStatus = deriveStatus(readiness, variant, entryCount > 0);
        const judge = delegatedJudge(spec);
        const mv = managerVerdictMap.get(l2.id) ?? null;
        const aiv = verdictMap.get(l2.id) ?? null;
        const shared = sharedGoalStatus({
          spec,
          readiness,
          entryTs: (act?.tss ?? [])
            .map((t) => (t instanceof Date ? t.getTime() : Number(t)))
            .filter((n) => Number.isFinite(n)),
          lockedKeys: locksByGoal.get(l2.id) ?? new Set(),
          createdAt: trackerStart.get(l2.id) ?? null,
          hireDate,
          tier: mv?.tier ?? aiv?.verdict.tier ?? null,
          now,
        });
        const status = shared.status;
        // Manager verdict wins over the AI cache wherever a tier shows.
        const tierOut = mv
          ? {
              tier: mv.tier,
              confidence: null,
              reasoning: mv.note,
              gradedAt: mv.gradedAt.toISOString(),
              source: "manager" as const,
              gradedByName: mv.gradedByName,
              ack: ackToJson(mv.ack),
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
        summary.byStatus[status] = (summary.byStatus[status] ?? 0) + 1;
        if (status === SHARED_STATUS.NEEDS_SETUP) summary.needsSetup += 1;
        if (status === SHARED_STATUS.UNCLASSIFIED) summary.noTracker += 1;
        if (status === SHARED_STATUS.AUTO) summary.auto += 1;
        if (status === SHARED_STATUS.NOT_LOGGED) summary.noData += 1;
        if (legacyStatus === "tracking") summary.tracking += 1;
        if (judge === "manager") summary.delegatedToYou += 1;
        if (mv?.ack?.disagree) summary.openDisputes += 1;
        if (act?.lastTs) {
          const iso = act.lastTs.toISOString();
          if (!summary.lastEntryAt || iso > summary.lastEntryAt) summary.lastEntryAt = iso;
        }
        if (!summary.worst || worstRank(status) < worstRank(summary.worst.status)) {
          summary.worst = {
            status,
            label: shared.label,
            tone: shared.tone,
            reason: shared.reason,
            goalTitle: l2.title,
          };
        }
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
          statusLabel: shared.label,
          statusTone: shared.tone,
          statusReason: shared.reason,
          logged: shared.logged,
          cadence: typeof spec?.widget === "string" && isSingleRecordWidget(spec.widget)
            ? null
            : specCadence(spec),
          readiness,
          kindLabel: specKindLabel(spec),
          variant,
          delegatedJudge: judge,
          entryCount,
          lastActivityAt: act?.lastTs ? act.lastTs.toISOString() : null,
          reading: readingMap.get(l2.id) ?? null,
          readingAsOf: readingMap.has(l2.id) ? readingAsOf : null,
          tier: tierOut,
          aiTier: aiv ? aiv.verdict.tier : null,
        };
      }),
    }));

    // The latest packet, and whether the viewing manager has looked at it.
    // "Seen" needs no new field: it's true once the manager read the
    // "packet submitted" notification, or graded any of this report's goals
    // after the packet arrived (they clearly had it open).
    let packet: { id: string; submittedAt: string; state: "new" | "seen" } | null = null;
    if (latestPacket) {
      const submitted = latestPacket.submittedAt;
      let seen = [...managerVerdictMap.values()].some(
        (v) => v.gradedAt instanceof Date && v.gradedAt.getTime() >= submitted.getTime(),
      );
      if (!seen && viewerId) {
        const note = await getNotificationsCollection().then((c) =>
          c.findOne(
            {
              orgId,
              userId: viewerId,
              kind: "review_packet_submitted",
              "data.packetId": latestPacket._id.toHexString(),
            },
            { projection: { readAt: 1 } },
          ),
        );
        seen = Boolean(note?.readAt);
      }
      packet = {
        id: latestPacket._id.toHexString(),
        submittedAt: submitted.toISOString(),
        state: seen ? "seen" : "new",
      };
    }

    return { user: toReportCard(target), summary: { ...summary, packet }, groups };
  }
}

export async function getReportGoalHealthHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { session, target } = await resolveReport(req);
    res.json(await computeGoalHealth(session.orgId, target, session.userId));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /manager/team-summary — every direct report's goal-health summary
 * in one round trip (the board `groups` are omitted; the team page only
 * needs the counts). Same managerId scoping as /reports.
 */
export async function getTeamSummaryHandler(
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
    const reports = await users
      .find({ orgId: session.orgId, managerId: session.userId, status: { $ne: "disabled" } })
      .toArray();
    const health = await Promise.all(
      reports.map((u) => computeGoalHealth(session.orgId, u, session.userId)),
    );
    res.json({
      reports: health.map((h) => ({ id: h.user.id, summary: h.summary })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── one goal's read-only review detail (for the grading drawer) ─────

/**
 * Full read-only projection of a single goal: its definition + tier
 * criteria, the engineer's logged evidence, and the AI verdict. Feeds the
 * manager's read-only GoalWidget view while grading. Boundary-scoped via
 * resolveReport, same as every other manager read.
 */
export async function getReportGoalDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { session, target } = await resolveReport(req);
    const goalId = req.params.goalId;
    const scope = { orgId: session.orgId, userId: target._id };

    const [tree, specDoc, aiDoc, managerVerdictMap, inputs, totalEntryCount] =
      await Promise.all([
        getGoalsCollection()
          .then((c) => c.findOne(scope))
          .then((t) => withAssignedTree(session.orgId, target._id, t)),
        isAssignedGoalId(goalId)
          ? (assignedSpecRecordFor(
              session.orgId,
              target._id,
              String(goalId),
            ) as Promise<GoalSpecRecord | null>)
          : getGoalSpecsCollection().then((c) => c.findOne({ ...scope, goalId })),
        // Whole-goal verdict only — see the identical guard in
        // getReportGoalHealthHandler above. Without the periodKey filter,
        // `findOne` on a collection that can now hold multiple rows per
        // goalId (whole-goal + per-window) returns an ARBITRARY match.
        getGoalTierVerdictsCollection().then((c) =>
          c.findOne({
            ...scope,
            goalId,
            $or: [
              { periodKey: WHOLE_GOAL_TIER_KEY },
              { periodKey: { $exists: false } },
            ],
          }),
        ),
        getManagerVerdictMap(session.orgId, target._id),
        getGoalInputsCollection().then((c) =>
          c.find({ ...scope, goalId }).sort({ ts: -1 }).limit(12).toArray(),
        ),
        getGoalInputsCollection().then((c) =>
          c.countDocuments({ ...scope, goalId }),
        ),
      ]);
    // Every entry's time + value (bounded) — the drawer groups readings per
    // cadence window instead of listing each click.
    const allEntries = await getGoalInputsCollection().then((c) =>
      c
        .find({ ...scope, goalId }, { projection: { ts: 1, value: 1 } })
        .sort({ ts: -1 })
        .limit(2000)
        .toArray(),
    );

    // Locate the L2 goal and its parent L1 in the report's tree.
    let l2: { id: string; code: string; title: string; category: string } | null =
      null;
    let l1: { id: string; code: string; title: string; category: string } | null =
      null;
    let rubric: string | null = null;
    for (const g1 of tree?.l1s ?? []) {
      const found = (g1.l2s ?? []).find((x) => x.id === goalId);
      if (found) {
        rubric = (found.rubric || "").trim() || (g1.rubric || "").trim() || null;
        l2 = {
          id: found.id,
          code: found.code,
          title: found.title,
          category: found.category,
        };
        l1 = {
          id: g1.id,
          code: g1.code,
          title: g1.title,
          category: g1.category,
        };
        break;
      }
    }
    if (!l2) {
      throw new HttpError(404, "not_found", "No such goal for this report.");
    }

    const mv = managerVerdictMap.get(goalId) ?? null;

    const detail = buildGoalDetail({
      l2,
      l1,
      spec: specDoc?.spec ?? null,
      aiVerdict: aiDoc ? { verdict: aiDoc.verdict, gradedAt: aiDoc.gradedAt } : null,
      managerVerdict: mv
        ? {
            tier: mv.tier,
            note: mv.note,
            gradedByName: mv.gradedByName,
            gradedAt: mv.gradedAt,
            ack: mv.ack ?? null,
          }
        : null,
      inputs,
      totalEntryCount,
      allEntries,
      rubric,
    });

    res.json({ user: toReportCard(target), ...detail });
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

    const body = (req.body ?? {}) as {
      tier?: unknown;
      note?: unknown;
      periodKey?: unknown;
    };
    if (typeof body.tier !== "string" || !TIERS.includes(body.tier as GoalTier)) {
      throw new HttpError(
        400,
        "invalid_tier",
        "Pick one of the four achievement tiers.",
      );
    }
    const tier = body.tier as GoalTier;
    const note = typeof body.note === "string" ? body.note.slice(0, 4_000) : "";
    // Optional grading period. Omitted → the calendar year of the grade.
    // Only YYYY / YYYY-Qn / YYYY-Hn / YYYY-MM within ±2 years of now.
    if (
      body.periodKey !== undefined &&
      body.periodKey !== null &&
      !isAcceptablePeriodKey(body.periodKey)
    ) {
      throw new HttpError(
        400,
        "invalid_period",
        `periodKey must look like "2026", "2026-Q1", "2026-H1" or "2026-03", within ${PERIOD_YEAR_WINDOW} years of now.`,
      );
    }
    const periodKey = isAcceptablePeriodKey(body.periodKey) ? body.periodKey : null;

    // The goal must exist in this report's tree — no orphan verdicts.
    // Shared goals count: the line manager grades them like any other.
    const tree = await withAssignedTree(
      session.orgId,
      target._id,
      await getGoalsCollection().then((c) =>
        c.findOne({ orgId: session.orgId, userId: target._id }),
      ),
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

    // Append-only: the previous grade for this period is superseded, not
    // overwritten (lib/manager-verdicts.ts).
    const written = await recordManagerVerdict({
      orgId: session.orgId,
      subjectUserId: target._id,
      goalId,
      tier,
      note,
      gradedBy: session.userId,
      gradedByName: managerName,
      periodKey,
    });

    // Same tier + note as the active grade: nothing changed, so no audit
    // row, no "changed a grade" notice, and the report's ack is kept.
    if (written.unchanged) {
      res.json({
        ok: true,
        unchanged: true,
        verdict: {
          goalId,
          tier,
          note,
          gradedByName: written.before?.gradedByName ?? managerName,
          source: "manager",
          periodKey: written.periodKey,
          changedFrom: null,
        },
      });
      return;
    }
    const tierChanged = Boolean(written.before && written.before.tier !== tier);

    // The grade of record has HR consequences — it must leave a trace,
    // with what it replaced. The action name predates grade history and
    // is kept so existing audit rows and saved filters still match.
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "manager.goal_verdict.set",
      targetType: "goal",
      targetId: goalId,
      before: written.before
        ? {
            subjectUserId: target._id.toHexString(),
            periodKey: written.periodKey,
            tier: written.before.tier,
            gradedByName: written.before.gradedByName,
            gradedAt: written.before.gradedAt.toISOString(),
            hasNote: written.before.note.length > 0,
          }
        : null,
      after: {
        subjectUserId: target._id.toHexString(),
        periodKey: written.periodKey,
        tier,
        hasNote: note.length > 0,
        eventId: written.eventId.toHexString(),
      },
      ...networkMeta(req),
    });

    // Best-effort inbox notice — must never block the grade itself.
    void createNotification({
      orgId: session.orgId,
      userId: target._id,
      kind: "manager_graded",
      title: tierChanged
        ? "Your manager changed a grade"
        : written.before
          ? "Your manager updated a grade note"
          : "Your manager graded a goal",
      // A changed grade says so — a silent downgrade was the trust gap.
      body:
        tierChanged && written.before
          ? `${managerName} changed "${goalTitle}" from ${TIER_LABEL[written.before.tier]} to ${TIER_LABEL[tier]}.`
          : `${managerName} set "${goalTitle}" to ${TIER_LABEL[tier]}.`,
      data: {
        goalId,
        tier,
        goalTitle,
        gradedByName: managerName,
        note,
        periodKey: written.periodKey,
        previousTier: written.before?.tier ?? null,
      },
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
        periodKey: written.periodKey,
        changedFrom: written.before?.tier ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /manager/reports/:userId/goals/:goalId/verdicts — one goal's grade
 * history (oldest first, every grade ever set, superseded ones included)
 * plus the current grade and the report's acknowledgement of it.
 * Same resolveReport boundary as every other per-report read.
 */
export async function listGoalVerdictHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { session, target } = await resolveReport(req);
    const goalId = String(req.params.goalId ?? "");
    if (!goalId || goalId.length > 200) {
      throw new HttpError(404, "not_found", "No such goal for this report.");
    }
    const { current, history } = await listManagerVerdictHistory(
      session.orgId,
      target._id,
      goalId,
    );
    res.json({ current: currentVerdictToJson(current), history });
  } catch (err) {
    next(err);
  }
}

// ─── review packets (a report's submitted evidence documents) ────────

/**
 * GET /manager/reports/:userId/review-packets — the report's frozen
 * evidence documents, newest first. The LATEST version includes the
 * full content (narrative, per-goal rows, the rendered markdown);
 * older versions are meta-only so the manager can see the submission
 * history without shipping N × 400KB blobs.
 */
export async function listReportReviewPacketsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { session, target } = await resolveReport(req);
    const col = await getReviewPacketsCollection();
    const rows = await col
      .find(
        { orgId: session.orgId, userId: target._id },
        { sort: { submittedAt: -1 }, limit: 20 },
      )
      .toArray();
    res.json({
      packets: rows.map((r, i) => ({
        id: r._id.toHexString(),
        submittedAt: r.submittedAt.toISOString(),
        level: r.level,
        rangeLabel: r.rangeLabel,
        goalCount: r.goalCount,
        starredCount: r.starredCount,
        ...(i === 0
          ? {
              narrative: r.narrative,
              goals: r.goals,
              markdown: r.markdown,
            }
          : {}),
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── tier policies (manager-authored criteria, by Goal Code) ─────────
//
// Distinct from the goal verdict above: that grades ONE report's ONE goal.
// A tier policy sets the CRITERIA TEXT for a Goal Code (L1 or L2), applying
// to every developer whose goal shares that code — org-wide, not scoped to
// this manager's own reports. An L2-code policy takes precedence over its
// parent L1-code policy, per field (see modules/tier-policies/controller.ts
// for the resolution order). `finalTiers` (whole-goal ladder) and
// `cadenceTiers` (per-cadence-window ladder) are set/read independently;
// neither is derived from or compared against the other.

/** Validates a { notAchieved, achieved, overAchieved, roleModel } shape,
 *  each an optional string|null capped at 600 chars. Returns null for an
 *  explicit `null` input (clears the policy field); throws on anything else
 *  malformed. Undefined input means "leave this field untouched". */
function parseTierCriteria(
  raw: unknown,
  fieldName: string,
): TierCriteria | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "invalid_tiers", `${fieldName} must be an object or null.`);
  }
  const obj = raw as Record<string, unknown>;
  const out: TierCriteria = {
    notAchieved: null,
    achieved: null,
    overAchieved: null,
    roleModel: null,
  };
  for (const key of ["notAchieved", "achieved", "overAchieved", "roleModel"] as const) {
    const v = obj[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") {
      throw new HttpError(400, "invalid_tiers", `${fieldName}.${key} must be a string or null.`);
    }
    out[key] = v.slice(0, 600);
  }
  return out;
}

/** List every manager tier policy in the org (authoring screen). */
export async function listTierPoliciesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const rows = await listTierPolicies(session.orgId);
    res.json({
      policies: rows.map((p) => ({
        code: p.code,
        cycleKey: p.cycleKey ?? null,
        finalTiers: p.finalTiers,
        cadenceTiers: p.cadenceTiers,
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * F6 — the codes that actually exist, with their blast radius. Powers
 * the authoring picker AND the "affects N goals across M people"
 * preview, replacing the free-text input where a typo governed nobody,
 * silently. Scans every goal tree in the org — bounded (tens of users,
 * hundreds of goals) and manager-gated.
 */
export async function listGoalCodesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const goals = await getGoalsCollection();
    const byCode = new Map<
      string,
      { code: string; level: "L1" | "L2"; title: string; goals: number; people: Set<string> }
    >();
    const tally = (
      code: string,
      level: "L1" | "L2",
      title: string,
      userId: string,
    ) => {
      const key = code.trim();
      if (!key) return;
      let row = byCode.get(key);
      if (!row) {
        row = { code: key, level, title, goals: 0, people: new Set() };
        byCode.set(key, row);
      }
      row.goals += 1;
      row.people.add(userId);
    };
    for await (const tree of goals.find({ orgId: session.orgId })) {
      const uid = String(tree.userId);
      for (const l1 of tree.l1s || []) {
        tally(l1.code || "", "L1", l1.title || "", uid);
        for (const l2 of l1.l2s || []) {
          tally(l2.code || "", "L2", l2.title || "", uid);
        }
      }
    }
    // Shared goals: one L2 per assignee, carrying the goal's code.
    const assigned = await getAssignedGoalsCollection();
    for await (const g of assigned.find({ orgId: session.orgId, status: "active" })) {
      for (const uid of g.assigneeIds) tally(g.code || "", "L2", g.title || "", String(uid));
    }
    res.json({
      codes: [...byCode.values()]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((r) => ({
          code: r.code,
          level: r.level,
          title: r.title,
          goals: r.goals,
          people: r.people.size,
        })),
    });
  } catch (err) {
    next(err);
  }
}

/** The stored policy row for (code, cycle) — the audit's `before`. */
async function findTierPolicyRow(
  orgId: ObjectId,
  code: string,
  cycleKey: string | null,
) {
  const rows = await listTierPolicies(orgId);
  return (
    rows.find((p) => p.code === code && (p.cycleKey ?? null) === cycleKey) ??
    null
  );
}

/** Audit projection of a policy row — the criteria text itself. */
function tierPolicyAuditState(
  row: { cycleKey?: string | null; finalTiers: TierCriteria | null; cadenceTiers: TierCriteria | null } | null,
) {
  if (!row) return null;
  return {
    cycleKey: row.cycleKey ?? "legacy",
    finalTiers: row.finalTiers ?? null,
    cadenceTiers: row.cadenceTiers ?? null,
  };
}

/** Set (or clear) the final and/or cadence tier criteria for a Goal Code. */
export async function putTierPolicyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const code = (req.params.code || "").trim();
    if (!code) {
      throw new HttpError(400, "invalid_code", "A Goal Code is required.");
    }
    const body = (req.body ?? {}) as {
      finalTiers?: unknown;
      cadenceTiers?: unknown;
      cycleKey?: unknown;
    };
    const finalTiers = parseTierCriteria(body.finalTiers, "finalTiers");
    const cadenceTiers = parseTierCriteria(body.cadenceTiers, "cadenceTiers");
    if (finalTiers === undefined && cadenceTiers === undefined) {
      throw new HttpError(
        400,
        "nothing_to_set",
        "Provide finalTiers and/or cadenceTiers.",
      );
    }
    // F6 — every new write is cycle-scoped. Omitted → the current year;
    // an explicit key must look like one so a typo can't mint a policy
    // no cycle will ever resolve.
    const cycleKey =
      body.cycleKey === undefined || body.cycleKey === null
        ? currentCycleKey()
        : String(body.cycleKey).trim();
    if (!/^\d{4}$/.test(cycleKey)) {
      throw new HttpError(400, "invalid_cycle", 'cycleKey must be "YYYY".');
    }

    const beforeRow = await findTierPolicyRow(session.orgId, code, cycleKey);
    const updated = await upsertTierPolicy({
      orgId: session.orgId,
      code,
      cycleKey,
      finalTiers,
      cadenceTiers,
      setBy: session.userId,
    });

    // Org-wide grading criteria, last-write-wins across managers —
    // exactly the kind of write the audit page must be able to answer
    // "who changed this and when, from what to what" for.
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "manager.tier_policy.set",
      targetType: "tier_policy",
      targetId: updated.code,
      before: tierPolicyAuditState(beforeRow),
      after: tierPolicyAuditState(updated),
      ...networkMeta(req),
    });

    // F6 — the governed must hear about it: changed criteria discovered
    // at grading time is the exact trust failure this feature exists to
    // close. Best-effort and after the response-critical work.
    void notifyGovernedEngineers(session.orgId, session.userId, code, cycleKey);

    res.json({
      policy: {
        code: updated.code,
        cycleKey: updated.cycleKey ?? null,
        finalTiers: updated.finalTiers,
        cadenceTiers: updated.cadenceTiers,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Notify every engineer whose tree carries `code` that its grading
 * criteria changed. Fire-and-forget from the policy PUT / DELETE — a
 * notify failure must never fail the save.
 *
 * Each row carries `goalCode` and — per recipient — the `goalId` of THEIR
 * goal with that code, so the bell deep-links to it rather than the bare
 * Goals page (see ./tier-policy-notify.ts for how the goal is picked).
 */
async function notifyGovernedEngineers(
  orgId: ObjectId,
  actorUserId: ObjectId,
  code: string,
  cycleKey: string | null,
  change: TierPolicyChange = "set",
): Promise<void> {
  try {
    const goals = await getGoalsCollection();
    // userId → the goal the policy governs for them (own tree first; a
    // shared goal with the code only when the tree has no match).
    const affected = new Map<string, GovernedGoal | null>();
    for await (const tree of goals.find({ orgId })) {
      const goal = findGovernedGoal(tree.l1s, code);
      if (goal) affected.set(String(tree.userId), goal);
    }
    const assigned = await getAssignedGoalsCollection();
    for await (const g of assigned.find({ orgId, status: "active", code })) {
      const goal: GovernedGoal = {
        goalId: assignedGoalId(g._id.toHexString()),
        goalTitle: g.title || null,
      };
      for (const uid of g.assigneeIds) {
        const key = String(uid);
        if (!affected.get(key)) affected.set(key, goal);
      }
    }
    const scope = cycleKey ? ` for ${cycleKey}` : "";
    for (const [uid, goal] of affected) {
      if (uid === String(actorUserId)) continue;
      const which = goal?.goalTitle ? `"${goal.goalTitle}"` : "Your matching goal";
      void createNotification({
        orgId,
        userId: new ObjectId(uid),
        kind: "tier_policy_updated",
        title: (change === "deleted"
          ? `Grading criteria removed: ${code}`
          : `Grading criteria updated: ${code}`
        ).slice(0, 200),
        body:
          change === "deleted"
            ? `Your manager removed the achievement-tier policy for Goal Code ${code}${scope}. ${which} is graded against its own ladder again.`
            : `Your manager changed the achievement-tier criteria governing Goal Code ${code}${scope}. ${which} is now graded against the new ladder.`,
        data: tierPolicyNotificationData({ code, cycleKey, change, goal }),
        createdBy: actorUserId,
      });
    }
  } catch {
    /* best-effort by design */
  }
}

/** Remove a Goal Code's manager policy entirely — matching goals fall back
 *  to their own AI-extracted / self-authored tiers again. */
export async function deleteTierPolicyHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const code = (req.params.code || "").trim();
    // Row identity: ?cycleKey=YYYY targets a scoped row; ?cycleKey=legacy
    // (or omitted) targets the unscoped pre-F6 row. Deleting one never
    // touches the other.
    const rawCycle = String(req.query.cycleKey ?? "legacy").trim();
    const cycleKey = /^\d{4}$/.test(rawCycle) ? rawCycle : null;
    const beforeRow = await findTierPolicyRow(session.orgId, code, cycleKey);
    const deleted = await deleteTierPolicy(session.orgId, code, cycleKey);
    if (deleted) {
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        actorRole: session.role,
        action: "manager.tier_policy.delete",
        targetType: "tier_policy",
        targetId: code,
        before: tierPolicyAuditState(beforeRow),
        after: { cycleKey: cycleKey ?? "legacy", deleted: true },
        ...networkMeta(req),
      });
      // The governed goals just lost their manager ladder — same trust
      // rule as the PUT: they hear about it now, not at grading time.
      void notifyGovernedEngineers(
        session.orgId,
        session.userId,
        code,
        cycleKey,
        "deleted",
      );
    }
    res.json({ ok: true, deleted });
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
  /** When the goal was classified as yours to judge — the queue shows
   *  how long each item has been waiting, which a bare list can't. */
  since: string | null;
  /** `note` is the rationale the manager wrote WITH the grade. The queue
   *  shows it, and re-opening the drawer edits it — without it the drawer
   *  re-opened empty and saved that emptiness over the real note. */
  verdict: {
    tier: string;
    gradedAt: string;
    gradedByName: string;
    note: string;
    ack: { at: string; disagree: boolean; note: string } | null;
  } | null;
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
        since: s.generatedAt ? s.generatedAt.toISOString() : null,
        verdict: v
          ? {
              tier: v.tier,
              gradedAt: v.gradedAt.toISOString(),
              gradedByName: v.gradedByName,
              note: v.note,
              ack: ackToJson(v.ack),
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
  /**
   * Fields the tracker READS instead of asking for — gathered from the base
   * schema AND from every per-period schema, because a query buried in week 9
   * is still a query this approval authorises.
   *
   * Plain English only. This is the human check on a query an AI composed, so
   * what ships is the sentence — "Checks AGENTS.md exists in espace/hubs
   * (GitHub)" — never a template id or a URL. An approver can't audit
   * `repo_file_exists`, and shouldn't have to.
   */
  autoFields: { label: string; description: string; provider: string | null }[];
  /**
   * Per-period content, when the tracker authored any. The manager is
   * approving a PLAN, not just a form — without this a 13-week tracker with
   * distinct weekly deliverables and a uniform one look identical in the
   * queue, and the thing most worth reviewing is invisible.
   */
  periods: { label: string; dueAt: string | null }[];
  tiers: Record<string, string> | null;
}

/**
 * Turn every field carrying a `source` — wherever in the spec it lives — into
 * one legible sentence for the approver. Deduped on the sentence itself: a
 * 13-week plan that checks the same file every week should read as one line,
 * not thirteen identical ones.
 */
function collectAutoFields(
  baseFields: unknown[],
  periods: unknown,
): { label: string; description: string; provider: string | null }[] {
  const out: { label: string; description: string; provider: string | null }[] = [];
  const seen = new Set<string>();

  const consider = (f: unknown): void => {
    const o = f && typeof f === "object" ? (f as Record<string, unknown>) : null;
    const source =
      o?.source && typeof o.source === "object"
        ? (o.source as Record<string, unknown>)
        : null;
    if (!source || typeof source.query !== "string") return;
    let description: string;
    try {
      description = queryRegistry.describeQuerySource?.(source) ?? "";
    } catch {
      description = "";
    }
    // No sentence, no row. A template id in the approval queue is worse than
    // nothing — it looks reviewed without being reviewable.
    if (!description) return;
    const label = typeof o?.label === "string" ? o.label : "";
    const key = `${label}::${description}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      label,
      description: description.slice(0, 240),
      provider: typeof source.provider === "string" ? source.provider : null,
    });
  };

  for (const f of baseFields) consider(f);
  for (const p of Array.isArray(periods) ? periods : []) {
    const o = p && typeof p === "object" ? (p as Record<string, unknown>) : null;
    for (const f of Array.isArray(o?.fields) ? (o.fields as unknown[]) : []) {
      consider(f);
    }
  }
  return out.slice(0, 20);
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
      const composed = spec.composed as
        | { cadence?: unknown; periods?: unknown }
        | undefined;
      // Labels + due dates only: enough to see the SHAPE of the plan without
      // shipping every per-period field schema into a list view.
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
      const autoFields = collectAutoFields(rawFields, composed?.periods);
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
        autoFields,
        periods,
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
    const [doc, tree] = await Promise.all([
      specs.findOne({
        orgId: session.orgId,
        userId: target._id,
        goalId,
      }),
      getGoalsCollection().then((c) =>
        c.findOne({ orgId: session.orgId, userId: target._id }),
      ),
    ]);
    // The goal must still be in the report's tree — the queue hides specs
    // orphaned by a deleted L2, so deciding one is never legitimate.
    const titles = goalTitleMap(tree);
    if (!doc || typeof goalId !== "string" || !titles.has(goalId)) {
      throw new HttpError(404, "not_found", "No such goal for this report.");
    }
    const existing =
      (doc.spec.approval as
        | { submittedAt?: unknown; status?: unknown; reviewedByName?: unknown }
        | undefined) ?? {};
    // Same rule as the admin twin: only a still-pending approval can be
    // decided (a double-click or a stale queue tab must not flip a decision,
    // nor stamp an approval block onto a spec that never had one).
    if (existing.status !== "pending") {
      throw new HttpError(409, "not_pending", "This goal isn't waiting for approval any more.");
    }

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

    const upd = await specs.updateOne(
      {
        orgId: session.orgId,
        userId: target._id,
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
      action: "manager.goal_approval.decide",
      targetType: "goal_spec",
      targetId: goalId,
      before: {
        subjectUserId: target._id.toHexString(),
        status: typeof existing.status === "string" ? existing.status : null,
        reviewedByName:
          typeof existing.reviewedByName === "string"
            ? existing.reviewedByName
            : null,
      },
      after: {
        subjectUserId: target._id.toHexString(),
        decision: body.decision,
        status: approval.status,
        hasNote: note.length > 0,
      },
      ...networkMeta(req),
    });

    const goalTitle = titles.get(goalId) ?? "your goal";

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
