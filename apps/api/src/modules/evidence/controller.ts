/**
 * Evidence controller — list / upsert / patch / delete user-starred
 * artifacts for the review export.
 *
 * Scope: per-user. Items are visible only to the user who starred
 * them, even within the same org. There's no shared "team evidence"
 * collection at this layer.
 *
 * Upsert semantics: POST always refreshes title / ref / date / impact
 * on re-star. This matches the frontend's toggle behaviour — re-clicking
 * the same artifact in the picker after its title was edited upstream
 * will show the new title. To remove, the frontend issues DELETE
 * /:id rather than another POST with a "remove" flag.
 */

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getEvidenceCollection } from "../../db/collections.js";
import type { EvidenceItem, EvidenceKind } from "../../db/types.js";
import { ALL_EVIDENCE_KINDS } from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";

// ─── schemas ─────────────────────────────────────────────────────────

const evidenceItemKindSchema = z.enum(
  ALL_EVIDENCE_KINDS as unknown as [EvidenceKind, ...EvidenceKind[]],
);

const upsertSchema = z.object({
  id: z.string().min(1).max(256),
  kind: evidenceItemKindSchema,
  ref: z.string().max(256).default(""),
  title: z.string().max(1_000).default(""),
  date: z.string().max(64).default(""),
  impact: z.string().max(4_000).default(""),
});

const patchSchema = z.object({
  impact: z.string().max(4_000),
});

const listQuerySchema = z.object({
  // Practical upper bound — typical scale is 5–20 items / user.
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// ─── shape helpers ───────────────────────────────────────────────────

interface PublicEvidence {
  id: string;
  kind: EvidenceKind;
  ref: string;
  title: string;
  date: string;
  impact: string;
  starredAt: string;
}

function toPublic(e: EvidenceItem): PublicEvidence {
  return {
    id: e.id,
    kind: e.kind,
    ref: e.ref,
    title: e.title,
    date: e.date,
    impact: e.impact,
    starredAt: e.starredAt.toISOString(),
  };
}

function idParam(req: Request): string {
  const { id } = req.params;
  if (typeof id !== "string" || id.length === 0 || id.length > 256) {
    throw new HttpError(400, "validation_error", "Invalid evidence id.");
  }
  return id;
}

// ─── GET /api/v1/evidence ────────────────────────────────────────────

export async function listEvidenceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { limit } = listQuerySchema.parse(req.query);
    const col = await getEvidenceCollection();
    const items = await col
      .find({ orgId: session.orgId, userId: session.userId })
      .sort({ starredAt: -1 })
      .limit(limit)
      .toArray();
    res.json({ items: items.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/evidence ───────────────────────────────────────────

/**
 * Upsert by `id`. Re-starring the same artifact refreshes the
 * cosmetic fields (title / ref / date) so a renamed PR shows its
 * latest title on next sync. `impact` is preserved through re-stars
 * — only PATCH and the user's manual edits change it.
 */
export async function upsertEvidenceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = upsertSchema.parse(req.body);
    const now = new Date();
    const col = await getEvidenceCollection();
    const result = await col.findOneAndUpdate(
      {
        orgId: session.orgId,
        userId: session.userId,
        id: payload.id,
      },
      {
        $set: {
          kind: payload.kind,
          ref: payload.ref,
          title: payload.title,
          date: payload.date,
          // Preserve impact across re-stars: only update if the
          // caller explicitly sent a non-empty value. The frontend's
          // toggleEvidence path sends impact:"" when starring fresh,
          // which would otherwise clobber a prior impact note. We
          // detect "non-empty" rather than "present" because z.string()
          // doesn't distinguish "" from missing.
          ...(payload.impact ? { impact: payload.impact } : {}),
        },
        $setOnInsert: {
          orgId: session.orgId,
          userId: session.userId,
          id: payload.id,
          impact: payload.impact,
          starredAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!result) {
      throw new HttpError(500, "internal_error", "Evidence upsert failed.");
    }
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "evidence.star",
      targetType: "evidence",
      targetId: payload.id,
      after: { kind: payload.kind },
      ...networkMeta(req),
    });
    res.json({ item: toPublic(result) });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/v1/evidence/:id ──────────────────────────────────────

export async function patchEvidenceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const id = idParam(req);
    const { impact } = patchSchema.parse(req.body);
    const col = await getEvidenceCollection();
    const result = await col.findOneAndUpdate(
      {
        orgId: session.orgId,
        userId: session.userId,
        id,
      },
      { $set: { impact } },
      { returnDocument: "after" },
    );
    if (!result) {
      throw new HttpError(404, "not_found", "Evidence item not found.");
    }
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "evidence.patch",
      targetType: "evidence",
      targetId: id,
      ...networkMeta(req),
    });
    res.json({ item: toPublic(result) });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/evidence/:id ─────────────────────────────────────

export async function deleteEvidenceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const id = idParam(req);
    const col = await getEvidenceCollection();
    const result = await col.deleteOne({
      orgId: session.orgId,
      userId: session.userId,
      id,
    });
    if (result.deletedCount === 0) {
      // 404 is more useful than 200 here — the frontend can confirm
      // whether the unstar actually removed something.
      throw new HttpError(404, "not_found", "Evidence item not found.");
    }
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "evidence.unstar",
      targetType: "evidence",
      targetId: id,
      ...networkMeta(req),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
