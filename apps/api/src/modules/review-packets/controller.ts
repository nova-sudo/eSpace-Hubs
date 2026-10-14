/**
 * Review-packets controller — the terminal step the review cycle never
 * had. "Submit for review" freezes the compiled evidence document
 * (rendered markdown + compact per-goal rows + narrative) as an
 * immutable, timestamped version; the manager reads the SAME artifact
 * from their board. Before this, the export ended as a file download on
 * the dev's laptop and neither side could prove what was submitted,
 * when, or against which readings (audit critical #217).
 *
 *   POST /api/v1/review-packets       submit (insert a new version)
 *   GET  /api/v1/review-packets/mine  my versions, newest first (meta only)
 *   GET  /api/v1/review-packets/:id   one packet — owner, their current
 *                                     manager, or an org admin (packet-access)
 *
 * Manager reads live in modules/manager (resolveReport-guarded).
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  getReviewPacketsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type { ReviewPacket } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { createNotification } from "../../lib/notifications.js";
import { effectiveCapabilities } from "../../lib/user-roles.js";
import { HttpError } from "../../middleware/error-handler.js";
import { loadGuardUser } from "../../middleware/require-capability.js";
import { packetAccess } from "./packet-access.js";
import { parsePacketBody } from "./packet-body.js";

/** Keep at most this many versions per dev — the history that matters
 *  is recent; unbounded growth of 400KB markdown blobs is not. */
const MAX_VERSIONS = 20;

// ─── POST /api/v1/review-packets ─────────────────────────────────────

export async function submitReviewPacketHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const body = parsePacketBody(req.body);

    const users = await getUsersCollection();
    const me = await users.findOne({
      _id: session.userId,
      orgId: session.orgId,
    });
    const managerId = me?.managerId ?? null;
    const manager = managerId
      ? await users.findOne(
          { _id: managerId, orgId: session.orgId },
          { projection: { displayName: 1, email: 1 } },
        )
      : null;
    const managerName = manager ? manager.displayName || manager.email : null;

    const col = await getReviewPacketsCollection();
    const now = new Date();
    // _id omitted — the driver mints it (OptionalUnlessRequiredId).
    const base = {
      orgId: session.orgId,
      userId: session.userId,
      managerId,
      submittedAt: now,
    };
    const doc: Omit<ReviewPacket, "_id"> =
      body.version === 2
        ? {
            ...base,
            version: 2,
            template: body.template,
            payload: body.payload,
            level: body.level,
            rangeLabel: body.rangeLabel,
            ...(body.markdown ? { markdown: body.markdown } : {}),
            goals: body.goals,
            goalCount: body.goalCount,
            starredCount: 0,
          }
        : {
            // v1 rows stay as they always were — no `version` field.
            ...base,
            level: body.level,
            rangeLabel: body.rangeLabel,
            narrative: body.narrative,
            markdown: body.markdown,
            goals: body.goals,
            goalCount: body.goals.length,
            starredCount: body.starredCount,
          };
    const inserted = await col.insertOne(doc as ReviewPacket);

    // Version housekeeping — drop anything beyond the newest MAX_VERSIONS.
    const stale = await col
      .find(
        { orgId: session.orgId, userId: session.userId },
        { projection: { _id: 1 }, sort: { submittedAt: -1 }, skip: MAX_VERSIONS },
      )
      .toArray();
    if (stale.length > 0) {
      await col.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "review_packet.submit",
      targetType: "review_packet",
      targetId: inserted.insertedId.toHexString(),
      after: {
        version: body.version,
        goalCount: doc.goalCount,
        starredCount: doc.starredCount,
        hasManager: managerId != null,
      },
      ...networkMeta(req),
    });

    if (managerId) {
      void createNotification({
        orgId: session.orgId,
        userId: managerId,
        kind: "review_packet_submitted",
        title: "A review packet was submitted",
        body: `${me?.displayName ?? "A report"} submitted their evidence document (${doc.goalCount} goals) for review.`,
        data: {
          packetId: inserted.insertedId.toHexString(),
          subjectUserId: session.userId.toHexString(),
          subjectName: me?.displayName ?? "",
        },
        createdBy: session.userId,
      });
    }

    res.json({
      ok: true,
      packet: {
        id: inserted.insertedId.toHexString(),
        submittedAt: now.toISOString(),
        hasManager: managerId != null,
        managerName,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/review-packets/mine ─────────────────────────────────

export async function listMyReviewPacketsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const col = await getReviewPacketsCollection();
    // Meta only — the dev's own status line doesn't need the 400KB blob.
    const rows = await col
      .find(
        { orgId: session.orgId, userId: session.userId },
        {
          projection: { markdown: 0, goals: 0, narrative: 0, payload: 0 },
          sort: { submittedAt: -1 },
          limit: MAX_VERSIONS,
        },
      )
      .toArray();
    // The dev's status line names who can read the packet. One lookup for
    // the (usually single) manager across all versions.
    const managerIds = [
      ...new Set(
        rows.flatMap((r) => (r.managerId ? [r.managerId.toHexString()] : [])),
      ),
    ].map((id) => new ObjectId(id));
    const managerNames = new Map<string, string>();
    if (managerIds.length > 0) {
      const users = await getUsersCollection();
      const managers = await users
        .find(
          { _id: { $in: managerIds } },
          { projection: { displayName: 1, email: 1 } },
        )
        .toArray();
      for (const m of managers) {
        managerNames.set(m._id.toHexString(), m.displayName || m.email);
      }
    }
    res.json({
      packets: rows.map((r) => ({
        id: r._id.toHexString(),
        submittedAt: r.submittedAt.toISOString(),
        level: r.level,
        rangeLabel: r.rangeLabel,
        goalCount: r.goalCount,
        starredCount: r.starredCount,
        hasManager: r.managerId != null,
        managerName: r.managerId
          ? (managerNames.get(r.managerId.toHexString()) ?? null)
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/review-packets/mine/:id ─────────────────────────────

/**
 * The frozen markdown of one of the dev's own submitted versions. Owner-
 * scoped: the filter carries the session's userId, so another user's
 * packet id 404s rather than 403s (no existence leak).
 */
export async function getMyReviewPacketHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const raw = String(req.params.id ?? "");
    if (!ObjectId.isValid(raw)) {
      throw new HttpError(404, "not_found", "No such packet.");
    }
    const col = await getReviewPacketsCollection();
    const row = await col.findOne({
      _id: new ObjectId(raw),
      orgId: session.orgId,
      userId: session.userId,
    });
    if (!row) {
      throw new HttpError(404, "not_found", "No such packet.");
    }
    res.json({
      packet: {
        id: row._id.toHexString(),
        submittedAt: row.submittedAt.toISOString(),
        level: row.level,
        rangeLabel: row.rangeLabel,
        goalCount: row.goalCount,
        starredCount: row.starredCount,
        hasManager: row.managerId != null,
        markdown: row.markdown,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/review-packets/:id ──────────────────────────────────

/**
 * One packet by id — the single URL the owner, their current manager
 * and an org admin all open. Anything else (bad id, other org, no
 * access) 404s, never 403s, so ids can't be probed.
 */
export async function getReviewPacketHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    // The caller's CURRENT roles, as the capability guard reads them. A
    // missing or disabled account is a 401 — the session outlived it.
    const caller = await loadGuardUser(session.userId, session.orgId);
    if (!caller || caller.status === "disabled") {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const capabilities = effectiveCapabilities(caller);
    const notFound = () => new HttpError(404, "not_found", "No such packet.");
    const raw = String(req.params.id ?? "");
    if (!/^[0-9a-fA-F]{24}$/.test(raw)) throw notFound();
    const col = await getReviewPacketsCollection();
    const row = await col.findOne({ _id: new ObjectId(raw), orgId: session.orgId });
    if (!row) throw notFound();

    const users = await getUsersCollection();
    const owner = await users.findOne(
      { _id: row.userId, orgId: session.orgId },
      { projection: { displayName: 1, email: 1, managerId: 1, status: 1 } },
    );
    const access = packetAccess({
      session: { userId: session.userId, orgId: session.orgId, capabilities },
      packet: row,
      owner,
    });
    if (!access) throw notFound();
    if (access === "admin") {
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        actorRole: session.role,
        action: "review_packet.admin_read",
        targetType: "review_packet",
        targetId: row._id.toHexString(),
        after: { subjectUserId: row.userId.toHexString() },
        ...networkMeta(req),
      });
    }

    res.json({
      packet: {
        id: row._id.toHexString(),
        version: row.version ?? 1,
        template: row.template ?? null,
        submittedAt: row.submittedAt.toISOString(),
        level: row.level,
        rangeLabel: row.rangeLabel,
        goalCount: row.goalCount,
        submitter: {
          id: row.userId.toHexString(),
          displayName: owner ? owner.displayName || owner.email : null,
        },
        ...(row.payload ? { payload: row.payload } : {}),
        ...(row.markdown != null ? { markdown: row.markdown } : {}),
        ...(row.narrative != null ? { narrative: row.narrative } : {}),
        goals: row.goals ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
}
