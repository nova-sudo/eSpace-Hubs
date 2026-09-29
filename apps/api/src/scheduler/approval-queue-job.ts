/**
 * Who a pending BYO approval waits on, and the "your queue is going
 * stale" nudge (hub-audit §1.3 / §3.4).
 *
 * Routing mirrors goal-specs + the admin approvals queue: the owner's
 * ACTIVE manager, else the org's admins. `pendingApprovals()` resolves
 * that once per scan so both scheduler jobs (the >24h per-item alert in
 * jobs.ts and the >3-day queue nudge here) notify the right people —
 * previously the per-item alert went to every manager in the org.
 */

import { ObjectId } from "mongodb";
import {
  getGoalSpecsCollection,
  getGoalsCollection,
  getUsersCollection,
} from "../db/collections.js";
import type { GoalL1, User } from "../db/types.js";
import { createNotification } from "../lib/notifications.js";
import { logger } from "../lib/logger.js";
import { effectiveRoles } from "../lib/user-roles.js";

const DAY_MS = 86_400_000;
/** A queue item older than this makes the whole queue "stale". */
export const STALE_QUEUE_DAYS = 3;

export type Approver =
  | { scope: "manager"; managerId: string }
  | { scope: "admins" };

/** Pure: the approver for an owner, given the org's users by hex id. */
export function approverFor(
  owner: Pick<User, "managerId">,
  byId: ReadonlyMap<string, Pick<User, "status">>,
): Approver {
  const hex = owner.managerId?.toHexString() ?? null;
  const manager = hex ? byId.get(hex) : undefined;
  if (hex && manager && manager.status !== "disabled") {
    return { scope: "manager", managerId: hex };
  }
  return { scope: "admins" };
}

export interface PendingApproval {
  specId: string;
  orgId: ObjectId;
  ownerId: ObjectId;
  ownerName: string;
  goalId: string;
  title: string;
  /** ms epoch: approval.submittedAt, else the spec's generatedAt. */
  submittedAt: number;
  approver: Approver;
}

/** Stable grouping key for an approver within an org. */
export function approverKey(orgId: ObjectId, a: Approver): string {
  return a.scope === "manager" ? `m:${a.managerId}` : `admins:${String(orgId)}`;
}

export interface StaleQueue {
  orgId: ObjectId;
  approver: Approver;
  stale: number;
  oldestDays: number;
}

/** Pure: approver queues holding at least one item older than `days`. */
export function staleQueues(
  items: readonly PendingApproval[],
  now: Date,
  days = STALE_QUEUE_DAYS,
): StaleQueue[] {
  const cutoff = now.getTime() - days * DAY_MS;
  const byKey = new Map<string, StaleQueue>();
  for (const it of items) {
    if (it.submittedAt > cutoff) continue;
    const key = approverKey(it.orgId, it.approver);
    const age = Math.floor((now.getTime() - it.submittedAt) / DAY_MS);
    const q = byKey.get(key);
    if (q) {
      q.stale += 1;
      q.oldestDays = Math.max(q.oldestDays, age);
    } else {
      byKey.set(key, { orgId: it.orgId, approver: it.approver, stale: 1, oldestDays: age });
    }
  }
  return [...byKey.values()];
}

/**
 * Pure: each owner's current L2 ids → titles, keyed by owner hex id. A
 * pending spec whose goal isn't in its owner's tree (the L2 was deleted,
 * the spec row stayed) is hidden by both approval queues, so the
 * scheduler must skip it too — otherwise it nudges about an item nobody
 * can see or clear.
 */
export function goalTitlesByOwner(
  trees: readonly { userId: ObjectId; l1s?: GoalL1[] | null }[],
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const t of trees) {
    const titles = new Map<string, string>();
    for (const l1 of t.l1s ?? []) {
      for (const l2 of l1.l2s ?? []) titles.set(l2.id, l2.title);
    }
    out.set(t.userId.toHexString(), titles);
  }
  return out;
}

/** Every pending BYO approval across orgs, with its resolved approver. */
export async function pendingApprovals(): Promise<PendingApproval[]> {
  const specs = await getGoalSpecsCollection();
  const users = await getUsersCollection();
  const rows = await specs.find({ "spec.approval.status": "pending" }).toArray();
  if (rows.length === 0) return [];
  const ownerIds = [
    ...new Map(rows.map((r) => [r.userId.toHexString(), r.userId] as const)).values(),
  ];
  const trees = await getGoalsCollection().then((c) =>
    c
      .find({ userId: { $in: ownerIds } }, { projection: { userId: 1, orgId: 1, l1s: 1 } })
      .toArray(),
  );
  const titlesByOwner = goalTitlesByOwner(
    trees.map((t) => ({ userId: t.userId, l1s: t.l1s })),
  );
  const orgIds = [
    ...new Map(rows.map((r) => [String(r.orgId), r.orgId] as const)).values(),
  ];
  const people = await users
    .find(
      { orgId: { $in: orgIds } },
      { projection: { displayName: 1, email: 1, status: 1, managerId: 1 } },
    )
    .toArray();
  const byId = new Map(people.map((u) => [u._id.toHexString(), u]));
  const out: PendingApproval[] = [];
  for (const r of rows) {
    const owner = byId.get(r.userId.toHexString());
    if (!owner || owner.status === "disabled") continue;
    const treeTitle = titlesByOwner.get(r.userId.toHexString())?.get(r.goalId);
    if (treeTitle === undefined) continue; // orphaned spec — no queue shows it
    const spec = r.spec as Record<string, unknown>;
    const approval = spec?.approval as { submittedAt?: unknown } | undefined;
    const submittedAt =
      typeof approval?.submittedAt === "number" && approval.submittedAt > 0
        ? approval.submittedAt
        : r.generatedAt.getTime();
    out.push({
      specId: String(r._id),
      orgId: r.orgId,
      ownerId: r.userId,
      ownerName: owner.displayName || owner.email || "A report",
      goalId: r.goalId,
      title:
        treeTitle || (typeof spec?.title === "string" && spec.title ? spec.title : r.goalId),
      submittedAt,
      approver: approverFor(owner, byId),
    });
  }
  return out;
}

/** Active admins of an org (the approvers for no-manager items). */
export async function activeAdmins(orgId: ObjectId): Promise<User[]> {
  const users = await getUsersCollection();
  const rows = await users.find({ orgId, status: "active" }).toArray();
  return rows.filter((u) => effectiveRoles(u).includes("admin"));
}

/** ISO week label ("2026-W39") — the once-a-week stamp for the nudge. */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Job — an approver's queue has an item waiting > 3 days. At most one
 * nudge per approver per ISO week (stamped), naming how many are stale
 * and the oldest wait. Admin-scoped queues nudge every active admin.
 */
export async function notifyStaleApprovalQueues(
  now: Date,
  claimStamp: (key: string) => Promise<boolean>,
): Promise<void> {
  const queues = staleQueues(await pendingApprovals(), now);
  const week = isoWeek(now);
  for (const q of queues) {
    try {
      const key = `stale-queue:${approverKey(q.orgId, q.approver)}:${week}`;
      if (!(await claimStamp(key))) continue;
      const title = `${q.stale} approval${q.stale === 1 ? "" : "s"} waiting over ${STALE_QUEUE_DAYS} days`;
      const body =
        q.approver.scope === "manager"
          ? `Your approvals queue has ${q.stale} tracker${q.stale === 1 ? "" : "s"} waiting — the oldest for ${q.oldestDays} days. Your reports can't log on them until you decide.`
          : `${q.stale} tracker${q.stale === 1 ? "" : "s"} from people with no manager ${q.stale === 1 ? "is" : "are"} waiting on the org's admins — the oldest for ${q.oldestDays} days.`;
      const data = { stale: q.stale, oldestDays: q.oldestDays, approverScope: q.approver.scope };
      const recipients =
        q.approver.scope === "manager"
          ? [q.approver.managerId]
          : (await activeAdmins(q.orgId)).map((a) => a._id.toHexString());
      for (const hex of recipients) {
        void createNotification({
          orgId: q.orgId,
          userId: new ObjectId(hex),
          kind: "approval_queue_stale",
          title,
          body,
          data,
        });
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[scheduler] stale-queue nudge failed for one approver",
      );
    }
  }
}
