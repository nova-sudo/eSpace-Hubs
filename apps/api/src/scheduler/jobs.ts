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
  getSnapshotsCollection,
  getUsersCollection,
} from "../db/collections.js";
import {
  WHOLE_GOAL_TIER_KEY,
  type GoalReading,
  type GoalTree,
  type Snapshot,
  type User,
} from "../db/types.js";
import { createNotification, emailAllowed } from "../lib/notifications.js";
import { effectiveRoles } from "../lib/user-roles.js";
import { sendEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { ObjectId as OID } from "mongodb";
import { assignedPeriodsOwed } from "./assigned-goals-job.js";
import { deadlineNudgeSkip, formatDueDay } from "./deadline-nudges.js";
import {
  activeAdmins,
  notifyStaleApprovalQueues,
  pendingApprovals,
} from "./approval-queue-job.js";

const DAY_MS = 86_400_000;
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tiers that read as "this goal is handled" — no nudge needed. */
const DONE_TIERS = new Set(["achieved", "over_achieved", "role_model"]);

/**
 * Claim an event key. True → we own it, act. False → already fired
 * (or the ledger is unreachable, in which case we DON'T act: silence
 * beats a duplicate nudge on every tick of a flaky deploy).
 */
export async function claimStamp(key: string): Promise<boolean> {
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

/** Stored specs for these goals, keyed by goalId (missing → no tracker). */
async function specsByGoal(
  orgId: ObjectId,
  userId: ObjectId,
  goalIds: string[],
): Promise<Map<string, unknown>> {
  if (goalIds.length === 0) return new Map();
  const col = await getGoalSpecsCollection();
  const rows = await col
    .find({ orgId, userId, goalId: { $in: goalIds } }, { projection: { goalId: 1, spec: 1 } })
    .toArray();
  return new Map(rows.map((r) => [r.goalId, r.spec as unknown]));
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
      const specs = await specsByGoal(
        tree.orgId,
        tree.userId,
        actionable.map((d) => d.goalId),
      );
      for (const d of actionable) {
        if (done.has(d.goalId)) continue;
        const overdue = d.daysUntil < 0;
        // Never nag about a goal the user can't act on (no tracker yet,
        // delegated, awaiting approval) or a recurring tracker's cycle end.
        if (deadlineNudgeSkip(specs.get(d.goalId), overdue)) continue;
        const due = formatDueDay(d.dueDate, now);
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
            ? `This goal was due ${due} (${Math.abs(d.daysUntil)} day${Math.abs(d.daysUntil) === 1 ? "" : "s"} ago) and isn't graded as achieved yet. Log what happened, or update the due date if the plan changed.`
            : `This goal is due ${due}. A quick fill now keeps the window from closing empty.`,
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
      // A tracker counts from the day it was created (its row's ObjectId
      // time): entries backfilled into earlier windows carry past `ts`, and
      // must not make a days-old tracker read "no updates in 3 weeks".
      const last = Math.max(
        lastByGoal.get(`${rec.userId}:${rec.goalId}`) ?? rec.generatedAt.getTime(),
        rec._id.getTimestamp().getTime(),
      );
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

/**
 * Job 3 — a BYO widget approval that's been waiting more than 24h.
 * Stamped per spec record id, so each submission alerts once. Routed to
 * the approver who can actually act (hub-audit §1.3): the owner's active
 * manager, else the org's admins — it used to go to every manager in the
 * org. A manager who misses it gets the >3-day queue nudge
 * (approval-queue-job.ts) and the digest line.
 */
export async function notifyWaitingApprovals(now: Date): Promise<void> {
  const cutoff = now.getTime() - DAY_MS;
  const adminsByOrg = new Map<string, User[]>();
  for (const item of await pendingApprovals()) {
    try {
      if (item.submittedAt > cutoff) continue;
      const key = `approval:${item.specId}`;
      if (!(await claimStamp(key))) continue;
      let recipients: ObjectId[];
      if (item.approver.scope === "manager") {
        recipients = [new OID(item.approver.managerId)];
      } else {
        const orgKey = String(item.orgId);
        let admins = adminsByOrg.get(orgKey);
        if (!admins) {
          admins = await activeAdmins(item.orgId);
          adminsByOrg.set(orgKey, admins);
        }
        recipients = admins.map((a) => a._id);
      }
      for (const to of recipients) {
        if (String(to) === String(item.ownerId)) continue;
        void createNotification({
          orgId: item.orgId,
          userId: to,
          kind: "approval_waiting",
          title: `Approval waiting >24h: ${item.title}`.slice(0, 200),
          body:
            item.approver.scope === "manager"
              ? `${item.ownerName} submitted a self-built tracker over a day ago and it's still pending your review.`
              : `${item.ownerName} has no manager, so their self-built tracker is waiting on the org's admins — it's been over a day.`,
          data: {
            goalId: item.goalId,
            ownerUserId: String(item.ownerId),
            approverScope: item.approver.scope,
          },
        });
      }
    } catch (err) {
      logger.warn(
        { specId: item.specId, err: err instanceof Error ? err.message : String(err) },
        "[scheduler] approval scan failed for one spec",
      );
    }
  }
}

/** Job 3b — see approval-queue-job.ts. Bound to this module's stamp ledger. */
export async function notifyStaleApprovals(now: Date): Promise<void> {
  await notifyStaleApprovalQueues(now, claimStamp);
}

/* ─── weekly server-side snapshots (#229, F4's second half) ─────────── */

/**
 * Sunday-anchored week number, UTC variant of the canonical
 * apps/web/src/lib/date.js `weekNumber` (week 1 contains Jan 1; each
 * later Sunday starts a new week). Duplicated rather than shared: the
 * web version deliberately uses LOCAL calendar components (an
 * Egypt-based team's browser), which a UTC server can't reproduce —
 * the 2-3h Cairo offset can only misfile an entry logged within a few
 * hours of Sunday midnight, an accepted imprecision for a weekly
 * bucket.
 */
function sunWeekNumberUtc(d: Date): number {
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week1Sunday = Date.UTC(d.getUTCFullYear(), 0, 1 - jan1.getUTCDay());
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor(Math.round((day - week1Sunday) / DAY_MS) / 7) + 1;
}

/** "W36-2026" — the snapshot week-label shape the client writes. */
function weekLabelUtc(d: Date): string {
  return `W${String(sunWeekNumberUtc(d)).padStart(2, "0")}-${d.getUTCFullYear()}`;
}

/** [start, end) of the Sunday-anchored week containing `d`, in UTC ms. */
function weekBoundsUtc(d: Date): { start: number; end: number } {
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const start = day - d.getUTCDay() * DAY_MS;
  return { start, end: start + 7 * DAY_MS };
}

/** The cadence-window label for a week-end date — mirrors the client's
 *  cadenceWindowFor (capture-readings.js) in UTC. */
function cadenceWindowForUtc(cadence: string, weekEnd: Date): string {
  const year = weekEnd.getUTCFullYear();
  const month = weekEnd.getUTCMonth() + 1;
  switch (cadence) {
    case "yearly":
      return `${year}`;
    case "quarterly":
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    case "monthly":
      return `${year}-${String(month).padStart(2, "0")}`;
    case "biweekly":
      return `${year}-F${String(Math.ceil(sunWeekNumberUtc(weekEnd) / 2)).padStart(2, "0")}`;
    case "weekly":
      return weekLabelUtc(weekEnd);
    case "daily":
      return `${year}-${String(month).padStart(2, "0")}-${String(weekEnd.getUTCDate()).padStart(2, "0")}`;
    default:
      return "lifetime";
  }
}

/**
 * Job 5 — freeze LAST week into a snapshot for every user who didn't
 * capture one themselves (#229: snapshots only happened on dashboard
 * visits, so a week without a visit vanished from compliance
 * denominators — "missed weeks stop happening silently").
 *
 * Scope honesty: the server can't reach provider tokens' metric math
 * (that lives client-side by design), so this captures what the server
 * DOES know — the manual trackers' goal-inputs — and stamps the row
 * `partial: true, gaps: ["provider-metrics"]`. windowMet stays null
 * (recorded, not judged): an entry's existence is the compliance
 * signal; target judgement remains the client capture's job.
 *
 * Manual-wins is preserved twice over: we skip users who already have
 * the week, and the write is $setOnInsert under the unique
 * (org,user,week) index — a concurrent client capture can never be
 * overwritten.
 */
export async function captureWeeklySnapshots(now: Date): Promise<void> {
  // The week being frozen is LAST week — complete by definition.
  const lastWeekDay = new Date(now.getTime() - 7 * DAY_MS);
  const week = weekLabelUtc(lastWeekDay);
  const { start, end } = weekBoundsUtc(lastWeekDay);
  const weekEnd = new Date(end - DAY_MS); // inclusive last day, label anchor

  const users = await getUsersCollection();
  const specsCol = await getGoalSpecsCollection();
  const inputsCol = await getGoalInputsCollection();
  const snapshots = await getSnapshotsCollection();

  for await (const user of users.find({ status: "active" })) {
    try {
      const existing = await snapshots.findOne(
        { orgId: user.orgId, userId: user._id, week },
        { projection: { _id: 1 } },
      );
      if (existing) continue;

      const specs = await specsCol
        .find({ orgId: user.orgId, userId: user._id })
        .toArray();
      // One query for the whole week, bucketed by goal — not one per spec.
      const entriesByGoal = new Map<string, { value: unknown }[]>();
      for await (const e of inputsCol.find({
        orgId: user.orgId,
        userId: user._id,
        ts: { $gte: new Date(start), $lt: new Date(end) },
      })) {
        (entriesByGoal.get(e.goalId) ?? entriesByGoal.set(e.goalId, []).get(e.goalId)!).push(e);
      }
      const goalReadings: Record<string, GoalReading> = {};
      for (const rec of specs) {
        const spec = rec.spec as Record<string, unknown>;
        if (!spec || typeof spec !== "object") continue;
        if (spec.source) continue; // auto — provider metrics, client-only
        if (spec.untrackable || spec.delegated) continue;
        if ((spec.approval as { status?: string } | undefined)?.status === "pending") continue;
        const manual = spec.manual as
          | { cadence?: string; target?: { op?: string; value?: number } }
          | undefined;
        const cadence = manual?.cadence || "weekly";
        const entries = entriesByGoal.get(rec.goalId) ?? [];
        // COUNTER entries carry numeric contributions; everything else
        // reads "how many times was this touched" — same split the
        // client capture makes, without importing its widget registry.
        const numericSum = entries.reduce((s, e) => {
          const n = Number(e.value);
          return Number.isFinite(n) ? s + n : s;
        }, 0);
        const weekContribution =
          spec.widget === "counter" ? numericSum : entries.length;
        const target =
          manual?.target &&
          typeof manual.target.op === "string" &&
          typeof manual.target.value === "number"
            ? { op: manual.target.op, value: manual.target.value }
            : null;
        goalReadings[rec.goalId] = {
          cadence,
          cadenceWindow: cadenceWindowForUtc(cadence, weekEnd),
          weekContribution,
          cumulative: null,
          target,
          windowMet: null,
          onPace: null,
        };
      }
      if (Object.keys(goalReadings).length === 0) continue; // dormant account — no noise rows

      // No stamp needed: the existence check above plus $setOnInsert
      // under the unique (org,user,week) index already make this
      // idempotent — a stamp would be a second lock on the same door.
      const doc: Snapshot = {
        _id: new OID(),
        orgId: user.orgId,
        userId: user._id,
        week,
        capturedAt: now,
        capturedBy: "auto",
        merged: 0,
        reviews: 0,
        turnaround: 0,
        linkage: 0,
        rounds: 0,
        note: "Server auto-capture — provider metrics unavailable; manual trackers only.",
        goalReadings,
        partial: true,
        gaps: ["provider-metrics"],
      };
      await snapshots.updateOne(
        { orgId: user.orgId, userId: user._id, week },
        { $setOnInsert: doc },
        { upsert: true },
      );
    } catch (err) {
      logger.warn(
        { userId: String(user._id), week, err: err instanceof Error ? err.message : String(err) },
        "[scheduler] weekly snapshot capture failed for one user",
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
  const notifications = await getNotificationsCollection();
  // One scan of the pending approvals for the whole digest run.
  let queue: Awaited<ReturnType<typeof pendingApprovals>> | null = null;
  const pendingQueue = async () => (queue ??= await pendingApprovals());

  for await (const user of users.find({ status: "active", passwordHash: { $ne: null } })) {
    try {
      const key = `digest:${user._id}:${week}`;
      if (!(await claimStamp(key))) continue;

      const tree = await goals.findOne({ orgId: user.orgId, userId: user._id });
      const allDued = tree ? flattenDueDates(tree, todayMs) : [];
      // Same rule as the bell: nothing the user can't act on.
      const digestSpecs = await specsByGoal(
        user.orgId,
        user._id,
        allDued.filter((d) => d.daysUntil <= 7).map((d) => d.goalId),
      );
      const dued = allDued.filter(
        (d) => !deadlineNudgeSkip(digestSpecs.get(d.goalId), d.daysUntil < 0),
      );
      const dueSoon = dued.filter((d) => d.daysUntil >= 0 && d.daysUntil <= 7);
      const overdue = dued.filter((d) => d.daysUntil < 0);
      const unread = await notifications.countDocuments({
        orgId: user.orgId,
        userId: user._id,
        readAt: null,
      });
      // Only approvals THIS person can decide: their reports' (manager),
      // or the no-manager queue (admin). It used to count every pending
      // approval in the org for every manager.
      const mine = String(user._id);
      const isAdmin = effectiveRoles(user).includes("admin");
      const pendingApprovals = (await pendingQueue()).filter(
        (p) =>
          String(p.orgId) === String(user.orgId) &&
          ((p.approver.scope === "manager" && p.approver.managerId === mine) ||
            (p.approver.scope === "admins" && isAdmin)),
      ).length;

      const sharedOwed = await assignedPeriodsOwed(user.orgId, user._id, now);

      if (dueSoon.length + overdue.length + unread + pendingApprovals + sharedOwed === 0) continue;

      const lines = [
        `Your week at eSpace Dev Hub (${week})`,
        "",
        ...(overdue.length
          ? [
              `OVERDUE (${overdue.length}):`,
              ...overdue.slice(0, 10).map((d) => `  - ${d.title} — was due ${formatDueDay(d.dueDate, now)}`),
              "",
            ]
          : []),
        ...(dueSoon.length
          ? [
              `DUE THIS WEEK (${dueSoon.length}):`,
              ...dueSoon.slice(0, 10).map((d) => `  - ${d.title} — due ${formatDueDay(d.dueDate, now)}`),
              "",
            ]
          : []),
        ...(sharedOwed
          ? [`SHARED GOALS OWED: ${sharedOwed} period${sharedOwed === 1 ? "" : "s"} open or missing`, ""]
          : []),
        ...(pendingApprovals
          ? [`APPROVALS WAITING ON YOU: ${pendingApprovals}`, ""]
          : []),
        ...(unread ? [`Unread notifications: ${unread}`, ""] : []),
        "Open your Dev Hub to act on any of these.",
      ];
      // Settings → Notifications "Email me" off: the digest is the one
      // routine email, so honour it here.
      if (!(await emailAllowed(user.orgId, user._id))) continue;
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
