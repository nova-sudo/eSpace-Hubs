/**
 * Notifications controller — the recipient's in-app inbox.
 *
 *   GET  /api/v1/notifications          my notifications + unread count
 *   POST /api/v1/notifications/read-all  mark all mine read
 *   POST /api/v1/notifications/:id/read  mark one mine read
 *
 * Every query is scoped to (session.orgId, session.userId) — a user only
 * ever sees and mutates their own inbox. Writing notifications is not a
 * client action; that goes through lib/notifications.ts from privileged
 * server code.
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { getNotificationsCollection } from "../../db/collections.js";
import type { Notification } from "../../db/types.js";
import { HttpError } from "../../middleware/error-handler.js";

interface PublicNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  createdAt: string;
  read: boolean;
}

function toPublic(n: Notification): PublicNotification {
  return {
    id: n._id.toHexString(),
    kind: n.kind,
    title: n.title,
    body: n.body,
    data: n.data ?? null,
    createdAt: n.createdAt.toISOString(),
    read: n.readAt != null,
  };
}

export async function listNotificationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const col = await getNotificationsCollection();
    const scope = { orgId: session.orgId, userId: session.userId };
    const [rows, unread] = await Promise.all([
      col.find(scope).sort({ createdAt: -1 }).limit(50).toArray(),
      col.countDocuments({ ...scope, readAt: null }),
    ]);
    res.json({ notifications: rows.map(toPublic), unread });
  } catch (err) {
    next(err);
  }
}

export async function markReadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const rawId = req.params.id;
    if (!ObjectId.isValid(rawId)) {
      throw new HttpError(404, "not_found", "No such notification.");
    }
    const col = await getNotificationsCollection();
    await col.updateOne(
      {
        _id: new ObjectId(rawId),
        orgId: session.orgId,
        userId: session.userId,
      },
      { $set: { readAt: new Date() } },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function markAllReadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const col = await getNotificationsCollection();
    await col.updateMany(
      { orgId: session.orgId, userId: session.userId, readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
