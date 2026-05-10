/**
 * Grading-verdicts controller — cache for AI-graded PR verdicts.
 *
 * This collection is a CACHE not a record. The 180-day TTL evicts
 * stale entries automatically. The /lookup endpoint NEVER refreshes
 * gradedAt — re-reading shouldn't reset the cache lifetime; if you
 * need a 180-day-from-most-recent-read window, that's a different
 * shape (sliding TTL via touch on read), and the trade-off isn't
 * obviously worth it for AI grading where re-grading a stale cache
 * miss is one Mistral call.
 *
 * Hot path: /lookup (called by the rubric widget on every render).
 * Cool paths: POST (after a successful grade), prune (after a rubric
 * change), DELETE all (rare, "reset cache" UX).
 */

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { getGradingVerdictsCollection } from "../../db/collections.js";
import type {
  GradingVerdict,
  GradingVerdictBody,
} from "../../db/types.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";

// ─── schemas (inline — small enough to keep here) ────────────────────

const verdictBodySchema = z.object({
  pass: z.boolean(),
  reasoning: z.string().max(4_000).default(""),
  violations: z.array(z.string().max(500)).max(50).default([]),
});

const upsertSchema = z.object({
  prId: z.union([
    z.string().min(1).max(200),
    // Allow numbers for back-compat with the localStorage shape.
    z.number().int().positive(),
  ]),
  rubricHash: z
    .string()
    .min(4)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, "rubricHash must be base64url-safe"),
  verdict: verdictBodySchema,
  model: z.string().max(200).nullable().optional(),
  provider: z.string().max(64).nullable().optional(),
});

const lookupQuerySchema = z.object({
  prId: z.union([z.string().min(1).max(200), z.coerce.number().int().positive()]),
  rubricHash: z
    .string()
    .min(4)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
});

const pruneSchema = z.object({
  // {[prId]: hash} — keep only entries that match. Anything else gets
  // dropped.
  currentRubricHashByPr: z
    .record(z.string().min(1).max(200), z.string().min(4).max(128))
    .default({}),
});

const listQuerySchema = z.object({
  prId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(2_000).default(500),
});

// ─── shape helpers ───────────────────────────────────────────────────

interface PublicVerdict {
  prId: string;
  rubricHash: string;
  verdict: GradingVerdictBody;
  gradedAt: string;
  model: string | null;
  provider: string | null;
}

function toPublic(v: GradingVerdict): PublicVerdict {
  return {
    prId: v.prId,
    rubricHash: v.rubricHash,
    verdict: v.verdict,
    gradedAt: v.gradedAt.toISOString(),
    model: v.model,
    provider: v.provider,
  };
}

// ─── GET /api/v1/grading-verdicts/lookup?prId=&rubricHash= ───────────

/**
 * Cache lookup. Returns 200 with `{cached: true|false, ...}` rather
 * than 404 for misses — the frontend can keep request handling
 * uniform (no try/catch on 404), and the response shape carries the
 * verdict body when present.
 */
export async function lookupVerdictHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { prId, rubricHash } = lookupQuerySchema.parse(req.query);

    const col = await getGradingVerdictsCollection();
    const cached = await col.findOne({
      orgId: session.orgId,
      userId: session.userId,
      prId: String(prId),
      rubricHash,
    });

    if (!cached) {
      res.json({ cached: false });
      return;
    }
    res.json({
      cached: true,
      verdict: cached.verdict,
      gradedAt: cached.gradedAt.toISOString(),
      model: cached.model,
      provider: cached.provider,
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/grading-verdicts ────────────────────────────────────

export async function listVerdictsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { prId, limit } = listQuerySchema.parse(req.query);
    const col = await getGradingVerdictsCollection();
    const filter: Record<string, unknown> = {
      orgId: session.orgId,
      userId: session.userId,
    };
    if (prId) filter.prId = prId;

    const verdicts = await col
      .find(filter)
      .sort({ gradedAt: -1 })
      .limit(limit)
      .toArray();
    res.json({ verdicts: verdicts.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/grading-verdicts ───────────────────────────────────

export async function upsertVerdictHandler(
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
    const prId = String(payload.prId);
    const now = new Date();

    const col = await getGradingVerdictsCollection();
    const result = await col.findOneAndUpdate(
      {
        orgId: session.orgId,
        userId: session.userId,
        prId,
        rubricHash: payload.rubricHash,
      },
      {
        $set: {
          verdict: payload.verdict,
          gradedAt: now,
          model: payload.model ?? null,
          provider: payload.provider ?? null,
        },
        $setOnInsert: {
          orgId: session.orgId,
          userId: session.userId,
          prId,
          rubricHash: payload.rubricHash,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    if (!result) {
      throw new HttpError(500, "internal_error", "Verdict upsert failed.");
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "grading_verdicts.upsert",
      targetType: "pr",
      targetId: prId,
      after: { pass: payload.verdict.pass, model: payload.model ?? null },
      ...networkMeta(req),
    });

    res.json(toPublic(result));
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/grading-verdicts/prune ─────────────────────────────

/**
 * Drop verdicts whose (prId, rubricHash) doesn't match the supplied
 * "current rubric hash per PR" map. Replaces the localStorage
 * `pruneUnrelated` GC pass — the dashboard calls this when it
 * detects a rubric change so the cache doesn't accumulate stale
 * entries from prior rubric versions.
 */
export async function pruneVerdictsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { currentRubricHashByPr } = pruneSchema.parse(req.body);
    const col = await getGradingVerdictsCollection();

    // Two-pass: load the user's verdicts, decide which keep + which
    // to delete in one batch. Avoids constructing a giant $or filter
    // with N clauses.
    const allForUser = await col
      .find(
        { orgId: session.orgId, userId: session.userId },
        { projection: { _id: 1, prId: 1, rubricHash: 1 } },
      )
      .toArray();

    const idsToDelete = allForUser
      .filter((v) => {
        const expected = currentRubricHashByPr[v.prId];
        return !expected || v.rubricHash !== expected;
      })
      .map((v) => v._id);

    let deleted = 0;
    if (idsToDelete.length > 0) {
      const r = await col.deleteMany({ _id: { $in: idsToDelete } });
      deleted = r.deletedCount ?? 0;
    }

    if (deleted > 0) {
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        actorRole: session.role,
        action: "grading_verdicts.prune",
        targetType: "user",
        targetId: session.userId.toHexString(),
        after: { deleted },
        ...networkMeta(req),
      });
    }
    res.json({ ok: true, deleted });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/v1/grading-verdicts ─────────────────────────────────

export async function deleteAllVerdictsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const col = await getGradingVerdictsCollection();
    const result = await col.deleteMany({
      orgId: session.orgId,
      userId: session.userId,
    });

    if (result.deletedCount > 0) {
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        actorRole: session.role,
        action: "grading_verdicts.delete_all",
        targetType: "user",
        targetId: session.userId.toHexString(),
        after: { deleted: result.deletedCount },
        ...networkMeta(req),
      });
    }
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    next(err);
  }
}
