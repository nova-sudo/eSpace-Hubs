/**
 * F4 scheduler jobs (#229). Each job is idempotent by construction:
 * before acting on an event it claims a stamp key via a unique-index
 * insert into `scheduler_stamps` — a duplicate key means another tick
 * (or a restarted process) already handled it. Jobs therefore run
 * safely on every hourly tick and on boot.
 *
 * Everything here is best-effort: a job failure is logged and the next
 * tick retries naturally (unclaimed stamps stay unclaimed). No job may
 * throw past its own boundary — the ticker wraps each call, but the
 * jobs also keep their per-item work inside try/catch so one bad
 * document doesn't starve the rest of the scan.
 *
 * Scale note: scans iterate full collections. Deliberate — this deploy
 * is a single small org (tens of users, hundreds of goals). If that
 * changes, add per-org batching before adding indexes.
 */

import type { ObjectId } from "mongodb";
import {
  getGoalInputsCollection,
  getGoalSpecsCollection,
  getGoalTierVerdictsCollection,
  getGoalsCollection,
  getNotificationsCollection,
  getSchedulerStampsCollection,
  getUsersCollection,
} from "../db/collections.js";
import { WHOLE_GOAL_TIER_KEY, type GoalTree, type User } from "../db/types.js";
import { createNotification } from "../lib/notifications.js";
import { effectiveRoles } from "../lib/user-roles.js";
import { sendEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { ObjectId as OID } from "mongodb";

const DAY_MS = 86_400_000;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tiers that read as "this goal is handled" — no nudge needed. */
const DONE_TIERS = new Set(["achieved", "over_achieved", "role_model"]);

/**
 * Claim an event key. True → we own it, act. False → already fired
 * (or the ledger is unreachable, in which case we DON'T act: silence
 * beats a duplicate nudge on every tick of a flaky deploy).
 */
async function claimStamp(key: string): Promise<boolean> {
  try {
    const col = await getSchedulerStampsCollection();
    await col.insertOne({ _id: new OID(), key, at: new Date() });
    return true;
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code !== 11000) {
      logger.warn(
        { key, err: err instanceof Error ? err.message : String(err) },
        "[scheduler] stamp claim failed",
      );
    }
    return false;
  }
}

interface DueGoal {
  goalId: string;
  title: string;
  dueDate: string;
  daysUntil: number;
}

function flattenDueDates(tree: GoalTree, todayMs: number): DueGoal[] {
  const out: DueGoal[] = [];
  for (const l1 of tree.l1s || []) {
    for (const l2 of l1.l2s || []) {
      if (!ISO_DAY_RE.test(l2.dueDate || "")) continue;
      const dueMs = Date.parse(`${l2.dueDate}T00:00:00Z`);
      if (Number.isNaN(dueMs)) continue;
      out.push({
        goalId: l2.id,
        title: l2.title || l2.code || l2.id,
        dueDate: l2.dueDate,
        daysUntil: Math.round((dueMs - todayMs) / DAY_MS),
      });
    }
  }
  return out;
}

/** goalIds whose whole-goal verdict already reads as done. */
async function doneGoalIds(
  orgId: ObjectId,
  userId: ObjectId,
  goalIds: string[],
): Promise<Set<string>> {
  if (goalIds.length === 0) return new Set();
  const verdicts = await getGoalTierVerdictsCollection();
  const rows = await verdicts
    .find(
      {
        orgId,
        userId,
        goalId: { $in: goalIds },
        periodKey: WHOLE_GOAL_TIER_KEY,
      },
      { projection: { goalId: 1, "verdict.tier": 1 } },
    )
    .toArray();
  return new Set(
    rows
      .filter((r) => DONE_TIERS.has(r.verdict?.tier))
      .map((r) => r.goalId),
  );
}

/**
 * Job 1 — due-soon (≤7 days out) and overdue nudges. Stamped per
 * (user, goal, dueDate), so editing the due date re-arms the nudge and
 * an unchanged one fires exactly once per state per TTL period.
 */
export async function notifyGoalDeadlines(now: Date): Promise<void> {
  const todayMs = Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const goals = await getGoalsCollection();
  for await (const tree of goals.find({})) {
    try {
      const dued = flattenDueDates(tree, todayMs);
      const actionable = dued.filter((d) => d.daysUntil <= 7);
      if (actionable.length === 0) continue;
      const done = await doneGoalIds(
        tree.orgId,
        tree.userId,
        actionable.map((d) => d.goalId),
      );
      for (const d of actionable) {
        if (done.has(d.goalId)) continue;
        const overdue = d.daysUntil < 0;
        const key = `${overdue ? "overdue" : "due_soon"}:${tree.userId}:${d.goalId}:${d.dueDate}`;
        if (!(await claimStamp(key))) continue;
        void createNotification({
          orgId: tree.orgId,
          userId: tree.userId,
          kind: overdue ? "goal_overdue" : "goal_due_soon",
          title: overdue
            ? `Overdue: ${d.title}`.slice(0, 200)
            : `Due ${d.daysUntil === 0 ? "today" : `in ${d.daysUntil}d`}: ${d.title}`.slice(0, 200),
          body: overdue
            ? `This goal was due ${d.dueDate} (${Math.abs(d.daysUntil)} day${Math.abs(d.daysUntil) === 1 ? "" : "s"} ago) and isn't graded as achieved yet. Log what happened, or update the due date if the plan changed.`
            : `This goal is due ${d.dueDate}. A quick fill now keeps the window from closing empty.`,
          data: { goalId: d.goalId, dueDate: d.dueDate },
        });
      }
    } catch (err) {
      logger.warn(
        { userId: String(tree.userId), err: err instanceof Error ? err.message : String(err) },
        "[scheduler] deadline scan failed for one tree",
      );
    }
  }
}

const STALE_AFTER_MS = 21 * DAY_MS;

/**
 * Job 2 — stale-goal nudges: a MANUAL tracker (no auto source) whose
 * last entry — or, with no entries ever, whose classification — is
 * more than 21 days old. Stamped per 21-day bucket so a goal that
 * stays untouched re-nudges every three weeks, not every hour.
 */
export async function notifyStaleGoals(now: Date): Promise<void> {
  const inputs = await getGoalInputsCollection();
  const lastByGoal = new Map<string, number>();
  const agg = inputs.aggregate<{ _id: { userId: ObjectId; goalId: string }; last: Date }>([
    { $group: { _id: { userId: "$userId", goalId: "$goalId" }, last: { $max: "$ts" } } },
  ]);
  for await (const row of agg) {
    lastByGoal.set(`${row._id.userId}:${row._id.goalId}`, row.last.getTime());
  }

  const bucket = Math.floor(now.getTime() / STALE_AFTER_MS);
  const specs = await getGoalSpecsCollection();
  for await (const rec of specs.find({})) {
    try {
      const spec = rec.spec as Record<string, unknown>;
      if (!spec || typeof spec !== "object") continue;
      if (spec.source) continue; // auto — reads itself, can't go stale by neglect
      if (spec.untrackable || spec.delegated) continue;
      const approval = spec.approval as { status?: string } | undefined;
      if (approval?.status === "pending") continue; // not active yet
      const last =
        lastByGoal.get(`${rec.userId}:${rec.goalId}`) ?? rec.generatedAt.getTime();
      if (now.getTime() - last < STALE_AFTER_MS) continue;
      const key = `stale:${rec.userId}:${rec.goalId}:${bucket}`;
      if (!(await claimStamp(key))) continue;
      const done = await doneGoalIds(rec.orgId, rec.userId, [rec.goalId]);
      if (done.has(rec.goalId)) continue; // stamp claimed anyway — done goals stay quiet
      const title = typeof spec.title === "string" && spec.title ? spec.title : rec.goalId;
      void createNotification({
        orgId: rec.orgId,
        userId: rec.userId,
        kind: "goal_stale",
        title: `No updates in 3 weeks: ${title}`.slice(0, 200),
        body: "This tracker hasn't seen an entry in over 21 days. Windows that pass empty count against compliance — log the latest, or mark the goal delegated/untrackable if it no longer applies.",
        data: { goalId: rec.goalId },
      });
    } catch (err) {
      logger.warn(
        { goalId: rec.goalId, err: err instanceof Error ? err.message : String(err) },
        "[scheduler] stale scan failed for one spec",
      );
    }
  }
}

async function activeManagers(orgId: ObjectId): Promise<User[]> {
  const users = await getUsersCollection();
  const rows = await users.find({ orgId, status: "active" }).toArray();
  return rows.filter((u) => effectiveRoles(u).includes("manager"));
}

/**
 * Job 3 — a BYO widget approval that's been waiting on a manager for
 * more than 24h. Stamped per spec record id, so each submission alerts
 * once; managers who miss it still see it in the digest.
 */
export async function notifyWaitingApprovals(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DAY_MS);
  const specs = await getGoalSpecsCollection();
  const managersByOrg = new Map<string, User[]>();
  const pending = specs.find({
    "spec.approval.status": "pending",
    generatedAt: { $lte: cutoff },
  });
  for await (const rec of pending) {
    try {
      const key = `approval:${rec._id}`;
      if (!(await claimStamp(key))) continue;
      const orgKey = String(rec.orgId);
      let managers = managersByOrg.get(orgKey);
      if (!managers) {
        managers = await activeManagers(rec.orgId);
        managersByOrg.set(orgKey, managers);
      }
      const users = await getUsersCollection();
      const owner = await users.findOne(
        { _id: rec.userId },
        { projection: { email: 1 } },
      );
      const spec = rec.spec as Record<string, unknown>;
      const title = typeof spec?.title === "string" && spec.title ? spec.title : rec.goalId;
      for (const m of managers) {
        if (String(m._id) === String(rec.userId)) continue;
        void createNotification({
          orgId: rec.orgId,
          userId: m._id,
          kind: "approval_waiting",
          title: `Approval waiting >24h: ${title}`.slice(0, 200),
          body: `${owner?.email || "A report"} submitted a self-built tracker over a day ago and it's still pending your review.`,
          data: { goalId: rec.goalId, ownerUserId: String(rec.userId) },
        });
      }
    } catch (err) {
      logger.warn(
        { specId: String(rec._id), err: err instanceof Error ? err.message : String(err) },
        "[scheduler] approval scan failed for one spec",
      );
    }
  }
}

/** ISO-8601 week label, e.g. "2026-W36" — the digest's once-per-week stamp. */
export function isoWeekLabel(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of this week decides the ISO year.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Job 4 — the Monday-morning digest email. Runs only when the tick
 * lands on Monday ≥07:00 UTC; the per-user week stamp makes the hourly
 * re-ticks harmless. Empty weeks (nothing due, nothing waiting,
 * nothing unread) send nothing — an email that says "no news" trains
 * people to delete the ones that matter.
 */
export async function sendWeeklyDigests(now: Date): Promise<void> {
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 7) return;
  const week = isoWeekLabel(now);
  const todayMs = Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z");

  const users = await getUsersCollection();
  const goals = await getGoalsCollection();
  const specs = await getGoalSpecsCollection();
  const notifications = await getNotificationsCollection();

  for await (const user of users.find({ status: "active", passwordHash: { $ne: null } })) {
    try {
      const key = `digest:${user._id}:${week}`;
      if (!(await claimStamp(key))) continue;

      const tree = await goals.findOne({ orgId: user.orgId, userId: user._id });
      const dued = tree ? flattenDueDates(tree, todayMs) : [];
      const dueSoon = dued.filter((d) => d.daysUntil >= 0 && d.daysUntil <= 7);
      const overdue = dued.filter((d) => d.daysUntil < 0);
      const unread = await notifications.countDocuments({
        orgId: user.orgId,
        userId: user._id,
        readAt: null,
      });
      const isManager = effectiveRoles(user).includes("manager");
      const pendingApprovals = isManager
        ? await specs.countDocuments({
            orgId: user.orgId,
            "spec.approval.status": "pending",
          })
        : 0;

      if (dueSoon.length + overdue.length + unread + pendingApprovals === 0) continue;

      const lines = [
        `Your week at eSpace Dev Hub (${week})`,
        "",
        ...(overdue.length
          ? [
              `OVERDUE (${overdue.length}):`,
              ...overdue.slice(0, 10).map((d) => `  - ${d.title} — was due ${d.dueDate}`),
              "",
            ]
          : []),
        ...(dueSoon.length
          ? [
              `DUE THIS WEEK (${dueSoon.length}):`,
              ...dueSoon.slice(0, 10).map((d) => `  - ${d.title} — due ${d.dueDate}`),
              "",
            ]
          : []),
        ...(pendingApprovals
          ? [`APPROVALS WAITING ON YOU: ${pendingApprovals}`, ""]
          : []),
        ...(unread ? [`Unread notifications: ${unread}`, ""] : []),
        "Open your Dev Hub to act on any of these.",
      ];
      void sendEmail({
        to: user.email,
        subject: `Dev Hub weekly — ${overdue.length ? `${overdue.length} overdue, ` : ""}${dueSoon.length} due this week`,
        text: lines.join("\n"),
      });
    } catch (err) {
      logger.warn(
        { userId: String(user._id), err: err instanceof Error ? err.message : String(err) },
        "[scheduler] digest failed for one user",
      );
    }
  }
}
