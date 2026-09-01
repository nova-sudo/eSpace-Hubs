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
