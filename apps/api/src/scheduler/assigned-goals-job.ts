/**
 * Shared (assigned) goal nudges — one hourly job, idempotent through
 * `claimStamp` like the rest of the scheduler:
 *
 *   due soon  an assignee hasn't submitted and the deadline is ≤48h away
 *   overdue   the deadline (+ grace) passed with nothing submitted — in-app
 *             + email, at most 14 days after the deadline
 *   report    once per period after its deadline: "3 late · 2 missing of
 *             12" to the creator and every viewer, at most 7 days after
 *
 * The look-back caps stop a first deploy (or a newly created goal whose
 * cycle started in the past) from flooding inboxes with stale periods.
 * Status comes from the shared `periodStatuses`, so a nudge never
 * disagrees with the grid.
 */

import { ObjectId } from "mongodb";
import {
  assignedGoalId,
  periodStatuses,
  type AssignedPeriodCell,
} from "@espace-devhub/shared/goal-specs";
import {
  getAssignedGoalsCollection,
  getGoalInputsCollection,
  getUsersCollection,
} from "../db/collections.js";
import type { AssignedGoal } from "../db/types.js";
import { createNotification } from "../lib/notifications.js";
import { sendEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";
import { claimStamp } from "./jobs.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const DUE_SOON_MS = 48 * HOUR_MS;
const OVERDUE_LOOKBACK_MS = 14 * DAY_MS;
const REPORT_LOOKBACK_MS = 7 * DAY_MS;

function fmtDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function cellsByAssignee(
  doc: AssignedGoal,
  nowMs: number,
): Promise<Map<string, AssignedPeriodCell[]>> {
  const inputs = await getGoalInputsCollection();
  const entries = await inputs
    .find(
      {
        orgId: doc.orgId,
        userId: { $in: doc.assigneeIds },
        goalId: assignedGoalId(doc._id.toHexString()),
      },
      { projection: { userId: 1, ts: 1, createdAt: 1, value: 1 } },
    )
    .toArray();
  const byUser = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = String(e.userId);
    const list = byUser.get(k) ?? [];
    list.push(e);
    byUser.set(k, list);
  }
  const out = new Map<string, AssignedPeriodCell[]>();
  for (const uid of doc.assigneeIds) {
    const k = String(uid);
    out.set(
      k,
      periodStatuses({
        spec: doc.spec,
        now: nowMs,
        graceMs: doc.graceHours * HOUR_MS,
        timeZone: doc.timeZone || "Africa/Cairo",
        entries: (byUser.get(k) ?? []).map((e) => ({
          ts: e.ts.getTime(),
          createdAt: e.createdAt ? e.createdAt.getTime() : null,
          value: e.value,
        })),
      }),
    );
  }
  return out;
}

export async function notifyAssignedGoalWindows(now: Date): Promise<void> {
  const nowMs = now.getTime();
  const col = await getAssignedGoalsCollection();
  const users = await getUsersCollection();

  for await (const doc of col.find({ status: "active" })) {
    try {
      const id = doc._id.toHexString();
      const goalId = assignedGoalId(id);
      const cells = await cellsByAssignee(doc, nowMs);

      // Per assignee: due soon / overdue.
      for (const [uid, row] of cells) {
        for (const c of row) {
          const pk = c.key ?? "once";
          if (c.status === "open" && c.deadline - nowMs <= DUE_SOON_MS) {
            if (!(await claimStamp(`asg_due:${id}:${uid}:${pk}`))) continue;
            void createNotification({
              orgId: doc.orgId,
              userId: new ObjectId(uid),
              kind: "assigned_goal_due_soon",
              title: `Due soon: ${doc.title} · ${c.label}`.slice(0, 200),
              body: `${c.label} of "${doc.title}" is due by ${fmtDay(c.deadline)}.`,
              data: { assignedGoalId: id, goalId, periodKey: c.key },
            });
          } else if (
            c.status === "missing" &&
            nowMs - c.deadline <= OVERDUE_LOOKBACK_MS
          ) {
            if (!(await claimStamp(`asg_over:${id}:${uid}:${pk}`))) continue;
            const userId = new ObjectId(uid);
            void createNotification({
              orgId: doc.orgId,
              userId,
              kind: "assigned_goal_overdue",
              title: `Overdue: ${doc.title} · ${c.label}`.slice(0, 200),
              body: `${c.label} of "${doc.title}" was due ${fmtDay(c.deadline)}. ${doc.createdByName} can see it's missing.`,
              data: { assignedGoalId: id, goalId, periodKey: c.key },
            });
            const u = await users.findOne(
              { _id: userId, orgId: doc.orgId, status: "active" },
              { projection: { email: 1, displayName: 1 } },
            );
            if (u?.email) {
              void sendEmail({
                to: u.email,
                subject: `Overdue: ${doc.title} · ${c.label}`,
                text: `Hi ${u.displayName || ""},\n\n${c.label} of the shared goal "${doc.title}" (from ${doc.createdByName}) was due ${fmtDay(c.deadline)} and nothing has been submitted yet. You can still fill it in from your Goals page — it will show as late.\n`,
              }).catch(() => undefined);
            }
          }
        }
      }

      // Per period: one report to the creator + viewers.
      const rows = [...cells.values()];
      const windowCount = rows[0]?.length ?? 0;
      for (let i = 0; i < windowCount; i += 1) {
        const deadline = rows[0][i].deadline;
        if (nowMs < deadline || nowMs - deadline > REPORT_LOOKBACK_MS) continue;
        const pk = rows[0][i].key ?? "once";
        if (!(await claimStamp(`asg_report:${id}:${pk}`))) continue;
        let onTime = 0;
        let late = 0;
        let missing = 0;
        for (const r of rows) {
          const s = r[i]?.status;
          if (s === "on_time") onTime += 1;
          else if (s === "late") late += 1;
          else if (s === "missing") missing += 1;
        }
        const label = rows[0][i].label;
        const recipients: ObjectId[] = [doc.createdBy, ...doc.viewerIds];
        for (const r of recipients) {
          void createNotification({
            orgId: doc.orgId,
            userId: r,
            kind: "assigned_goal_period_report",
            title: `${doc.title} · ${label}: ${onTime + late}/${rows.length} submitted`.slice(0, 200),
            body: `${onTime} on time · ${late} late · ${missing} missing.`,
            data: { assignedGoalId: id, periodKey: rows[0][i].key, onTime, late, missing },
          });
        }
      }
    } catch (err) {
      logger.warn(
        { assignedGoalId: String(doc._id), err: err instanceof Error ? err.message : String(err) },
        "[scheduler] assigned-goal nudge failed for one goal",
      );
    }
  }
}

/** Monday-digest helper: how many shared-goal periods this user owes right now. */
export async function assignedPeriodsOwed(
  orgId: ObjectId,
  userId: ObjectId,
  now: Date,
): Promise<number> {
  const col = await getAssignedGoalsCollection();
  let owed = 0;
  for await (const doc of col.find({ orgId, assigneeIds: userId, status: "active" })) {
    const cells = (await cellsByAssignee({ ...doc, assigneeIds: [userId] }, now.getTime())).get(
      String(userId),
    );
    owed += (cells ?? []).filter((c) => c.status === "missing" || c.status === "open").length;
  }
  return owed;
}
