/**
 * Notifications controller — the recipient's in-app inbox.
 *
 *   GET  /api/v1/notifications              my notifications (paged) + unread count
 *   GET  /api/v1/notifications/preferences  my muted kinds + email opt-in
 *   PUT  /api/v1/notifications/preferences  update them
 *   POST /api/v1/notifications/read-all     mark all mine read
 *   POST /api/v1/notifications/:id/read     mark one mine read
 *
 * Every query is scoped to (session.orgId, session.userId) — a user only
 * ever sees and mutates their own inbox. Writing notifications is not a
 * client action; that goes through lib/notifications.ts from privileged
 * server code.
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import {
  getNotificationPrefsCollection,
  getNotificationsCollection,
} from "../../db/collections.js";
import {
  ALL_NOTIFICATION_KINDS,
  type Notification,
  type NotificationKind,
} from "../../db/types.js";
import {
  isMutableKind,
  readNotificationPrefs,
  UNMUTABLE_NOTIFICATION_KINDS,
} from "../../lib/notifications.js";
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

/**
 * Keyset cursor over (createdAt desc, _id desc): "<ISO>_<hex id>". Opaque
 * to the client — it only ever echoes back `nextCursor`.
 */
function encodeCursor(n: Notification): string {
  return `${n.createdAt.toISOString()}_${n._id.toHexString()}`;
}

function decodeCursor(raw: unknown): { at: Date; id: ObjectId } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const sep = raw.lastIndexOf("_");
  if (sep < 0) return null;
  const at = new Date(raw.slice(0, sep));
  const hex = raw.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !/^[0-9a-f]{24}$/i.test(hex)) return null;
  return { at, id: new ObjectId(hex) };
}

/**
 * GET /api/v1/notifications?limit=&cursor=&unread=1
 *
 * Newest first, keyset-paginated (hub-audit §3.4 — the old hard cap of 50
 * made notification 51 unreachable). `limit` defaults to 50 (1..100) so
 * the bell's plain GET is unchanged. `unread=1` narrows to unread rows.
 *
 *   → { notifications, unread, hasMore, nextCursor }
 */
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
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
      : 50;
    const cursorRaw = req.query.cursor;
    const cursor = decodeCursor(cursorRaw);
    if (cursorRaw !== undefined && !cursor) {
      throw new HttpError(400, "validation_error", "Invalid cursor.");
    }
    const unreadOnly = req.query.unread === "1" || req.query.unread === "true";

    const col = await getNotificationsCollection();
    const scope = { orgId: session.orgId, userId: session.userId };
    const filter: Record<string, unknown> = { ...scope };
    if (unreadOnly) filter.readAt = null;
    if (cursor) {
      filter.$or = [
        { createdAt: { $lt: cursor.at } },
        { createdAt: cursor.at, _id: { $lt: cursor.id } },
      ];
    }
    const [rows, unread] = await Promise.all([
      col
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .toArray(),
      col.countDocuments({ ...scope, readAt: null }),
    ]);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    res.json({
      notifications: page.map(toPublic),
      unread,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  } catch (err) {
    next(err);
  }
}

// ─── preferences ─────────────────────────────────────────────────────

/**
 * GET /api/v1/notifications/preferences → { muted, email, kinds, unmutable }
 * `unmutable` lists the kinds the settings UI must show as always-on.
 */
export async function getPreferencesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const prefs = await readNotificationPrefs(session.orgId, session.userId);
    res.json({
      muted: prefs.muted.filter(isMutableKind),
      email: prefs.email,
      kinds: ALL_NOTIFICATION_KINDS,
      unmutable: UNMUTABLE_NOTIFICATION_KINDS,
    });
  } catch (err) {
    next(err);
  }
}

const preferencesSchema = z
  .object({
    muted: z
      .array(z.enum(ALL_NOTIFICATION_KINDS as unknown as [string, ...string[]]))
      .max(64)
      .optional(),
    email: z.boolean().optional(),
  })
  .strict();

/**
 * PUT /api/v1/notifications/preferences { muted?, email? }
 * Partial — omitted fields keep their stored (or default) value.
 *   → { muted, email }
 */
export async function putPreferencesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const body = preferencesSchema.parse(req.body ?? {});
    const current = await readNotificationPrefs(session.orgId, session.userId);
    // Unmutable kinds are dropped silently (not a 400): an older client
    // may still hold them in its list from before the floor existed.
    const muted = (
      body.muted ? ([...new Set(body.muted)] as NotificationKind[]) : current.muted
    ).filter(isMutableKind);
    const email = body.email ?? current.email;
    const col = await getNotificationPrefsCollection();
    await col.updateOne(
      { orgId: session.orgId, userId: session.userId },
      {
        $set: { muted, email, updatedAt: new Date() },
        $setOnInsert: { orgId: session.orgId, userId: session.userId },
      },
      { upsert: true },
    );
    res.json({ muted, email });
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
