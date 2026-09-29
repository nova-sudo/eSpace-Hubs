/**
 * Notification writer. The one place that inserts inbox rows, used by
 * privileged actions (manager grading, BYO approval) and the scheduler.
 * Best-effort by design: a failed inbox write must never fail the action
 * that triggered it — callers `void createNotification(...)` after their
 * own commit, and this swallows/logs errors and returns null.
 *
 * Preferences (hub-audit §3.4): a kind the recipient muted is never
 * written (returns null). `emailAllowed()` is the check every
 * non-security email path runs before sending (weekly digest, admin
 * alerts). A failed preference read fails OPEN — delivering a
 * notification someone muted is a smaller harm than silently dropping
 * one they needed.
 */

import { ObjectId } from "mongodb";
import {
  getGoalsCollection,
  getNotificationPrefsCollection,
  getNotificationsCollection,
  getUsersCollection,
} from "../db/collections.js";
import type { Notification, NotificationKind } from "../db/types.js";
import { logger } from "./logger.js";
import { withAssignedTree } from "./assigned-goals.js";

export interface CreateNotificationInput {
  orgId: ObjectId;
  /** Recipient. */
  userId: ObjectId;
  kind: NotificationKind;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  /** Actor who triggered it (the manager), or null for system events. */
  createdBy?: ObjectId | null;
}

/** Resolved preferences — the defaults when the user never saved any. */
export interface ResolvedNotificationPrefs {
  muted: NotificationKind[];
  email: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: ResolvedNotificationPrefs = Object.freeze({
  muted: [],
  email: true,
}) as ResolvedNotificationPrefs;

/** The recipient's preferences, or the defaults. Throws on a DB error. */
export async function readNotificationPrefs(
  orgId: ObjectId,
  userId: ObjectId,
): Promise<ResolvedNotificationPrefs> {
  const col = await getNotificationPrefsCollection();
  const row = await col.findOne(
    { orgId, userId },
    { projection: { muted: 1, email: 1 } },
  );
  if (!row) return DEFAULT_NOTIFICATION_PREFS;
  return {
    muted: Array.isArray(row.muted) ? row.muted : [],
    email: row.email !== false,
  };
}

/**
 * Kinds nobody may mute: each is sent only to the person who has to ACT on
 * it (an approver deciding a tracker or a sign-up, a dev whose tracker was
 * sent back, a report or manager told about a reassignment). Muting them
 * would strand work only the recipient can clear — the org-admin queue is
 * the only path for no-manager trackers. Filtered out of stored mutes on
 * write, and ignored on delivery even if an old prefs row lists them.
 */
export const UNMUTABLE_NOTIFICATION_KINDS: readonly NotificationKind[] = Object.freeze([
  "goal_submitted",
  "approval_waiting",
  "approval_queue_stale",
  "goal_changes_requested",
  "user_pending_approval",
  "manager_changed",
] as NotificationKind[]);

/** Pure: may a user mute this kind? */
export function isMutableKind(kind: NotificationKind): boolean {
  return !UNMUTABLE_NOTIFICATION_KINDS.includes(kind);
}

/** Pure: would this kind reach the inbox under these preferences? */
export function kindDelivered(
  prefs: ResolvedNotificationPrefs,
  kind: NotificationKind,
): boolean {
  return !isMutableKind(kind) || !prefs.muted.includes(kind);
}

/** May the app email this user? Fails open (true) on a read error. */
export async function emailAllowed(
  orgId: ObjectId,
  userId: ObjectId,
): Promise<boolean> {
  try {
    return (await readNotificationPrefs(orgId, userId)).email;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[notifications] email-preference read failed — sending",
    );
    return true;
  }
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<ObjectId | null> {
  try {
    let prefs = DEFAULT_NOTIFICATION_PREFS;
    try {
      prefs = await readNotificationPrefs(input.orgId, input.userId);
    } catch {
      /* fail open — deliver */
    }
    if (!kindDelivered(prefs, input.kind)) return null;

    const col = await getNotificationsCollection();
    const doc: Notification = {
      _id: new ObjectId(),
      orgId: input.orgId,
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      data: input.data ?? null,
      createdAt: new Date(),
      createdBy: input.createdBy ?? null,
      readAt: null,
    };
    await col.insertOne(doc);
    return doc._id;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[notifications] create failed",
    );
    return null;
  }
}

/**
 * A report acknowledged a manager grade with "I disagree". Tell the
 * report's CURRENT manager — the one who owns the grade now, even if a
 * previous manager set it before a reassignment — with the report's note,
 * deep-linking to that report's board. With no active manager on file the
 * org's active admins get it instead. Best-effort like every writer here —
 * resolves the report's name, manager and the goal's title (shared `asg_`
 * goals included) itself so callers pass ids only.
 */
export async function notifyVerdictDisputed(input: {
  orgId: ObjectId;
  subjectUserId: ObjectId;
  /** Who set the grade (`verdict.gradedBy`) — only for the "your" wording. */
  gradedBy: ObjectId;
  goalId: string;
  tier: string;
  note: string;
}): Promise<ObjectId[]> {
  try {
    const users = await getUsersCollection();
    const [subject, stored] = await Promise.all([
      users.findOne(
        { _id: input.subjectUserId, orgId: input.orgId },
        { projection: { displayName: 1, email: 1, managerId: 1 } },
      ),
      getGoalsCollection().then((c) =>
        c.findOne({ orgId: input.orgId, userId: input.subjectUserId }),
      ),
    ]);
    const tree = await withAssignedTree(input.orgId, input.subjectUserId, stored);
    let goalTitle = "a goal";
    for (const l1 of tree?.l1s ?? []) {
      for (const l2 of l1.l2s ?? []) {
        if (l2.id === input.goalId) goalTitle = l2.title;
      }
    }

    const manager = subject?.managerId
      ? await users.findOne(
          { _id: subject.managerId, orgId: input.orgId },
          { projection: { status: 1 } },
        )
      : null;
    const recipients =
      manager && manager.status === "active"
        ? [manager._id]
        : (
            await users
              .find(
                {
                  orgId: input.orgId,
                  status: "active",
                  $or: [{ role: "admin" }, { roles: "admin" }],
                },
                { projection: { _id: 1 } },
              )
              .toArray()
          ).map((a) => a._id);

    const name = subject?.displayName || subject?.email || "A report";
    const tier = input.tier.replace(/_/g, " ");
    const out: ObjectId[] = [];
    for (const userId of recipients) {
      // "your grade" only for the person who actually set it.
      const whose = userId.equals(input.gradedBy) ? "your" : "the";
      const id = await createNotification({
        orgId: input.orgId,
        userId,
        kind: "verdict_disputed",
        title: `${name} disagrees with a grade`.slice(0, 200),
        body: `${name} disagreed with ${whose} "${tier}" grade on "${goalTitle}".`.slice(0, 2_000),
        data: {
          goalId: input.goalId,
          goalTitle,
          subjectUserId: input.subjectUserId.toHexString(),
          subjectName: name,
          tier: input.tier,
          note: input.note,
          ...(manager && manager.status === "active" ? {} : { approverScope: "admins" }),
        },
        createdBy: input.subjectUserId,
      });
      if (id) out.push(id);
    }
    return out;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[notifications] verdict-disputed notify failed",
    );
    return [];
  }
}
