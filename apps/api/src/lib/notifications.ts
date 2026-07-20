/**
 * Notification writer. The one place that inserts inbox rows, used by
 * privileged actions (manager grading, later BYO approval). Best-effort
 * by design: a failed inbox write must never fail the action that
 * triggered it — callers `void createNotification(...)` after their own
 * commit, and this swallows/logs errors and returns null.
 */

import { ObjectId } from "mongodb";
import { getNotificationsCollection } from "../db/collections.js";
import type { Notification, NotificationKind } from "../db/types.js";
import { logger } from "./logger.js";

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

export async function createNotification(
  input: CreateNotificationInput,
): Promise<ObjectId | null> {
  try {
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
