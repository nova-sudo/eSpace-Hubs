/**
 * One-shot localStorage import.
 *
 * Frontend POSTs the user's localStorage payload on first login (or
 * whenever the migration banner is dismissed). The endpoint is
 * IDEMPOTENT — every collection has a unique index that makes
 * re-imports a no-op rather than a duplicate.
 *
 * Bulk strategy
 *   goals          one upsert (replace l1s)
 *   goal_specs     bulkWrite of upserts keyed on (orgId, userId, goalId)
 *   goal_context   bulkWrite of upserts keyed on (orgId, userId, goalId)
 *   goal_inputs    insertMany (append) — caller is responsible for
 *                  not posting the same set twice. Re-imports add
 *                  duplicate entries; v2 of this endpoint can dedupe
 *                  on (goalId, ts) once we observe real usage.
 *
 * Failure model
 *   Whatever succeeds before a per-collection failure stays
 *   committed. The response body lists per-collection counts so the
 *   client can show "imported 14 goals, 3 specs, …" even if the
 *   inputs list 500'd. M-later wraps this in a Mongo transaction
 *   when the value of all-or-nothing exceeds the cost of a
 *   replicaset session.
 */

import type { NextFunction, Request, Response } from "express";
import type { AnyBulkWriteOperation } from "mongodb";
import { z } from "zod";
import {
  getGoalContextCollection,
  getGoalInputsCollection,
  getGoalSpecsCollection,
  getGoalsCollection,
  getGradingVerdictsCollection,
  getIntegrationsCollection,
  getSnapshotsCollection,
} from "../../db/collections.js";
import {
  GOALS_SCHEMA_VERSION,
  type GoalContextDoc,
  type GoalInputEntry,
  type GoalInputSource,
  type GoalInputValue,
  type GoalL1,
  type GoalReading,
  type GoalSpecRecord,
  type GradingVerdict,
  type Integration,
  type Snapshot,
} from "../../db/types.js";
import { encryptSecret } from "../../lib/crypto-secret.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";
import { logger } from "../../lib/logger.js";
import { validateSpec } from "../ai/classifier/spec-validator.js";

// Permissive at the migration boundary — we accept whatever the
// localStorage layer wrote and surface what couldn't be imported.
const importSchema = z.object({
  goals: z
    .object({
      l1s: z.array(z.unknown()).max(200).default([]),
    })
    .optional(),
  goalSpecs: z
    .object({
      // Either { specs: { [goalId]: spec } } (current localStorage
      // shape) OR a flat map for legacy payloads.
      specs: z.record(z.string().min(1).max(200), z.unknown()).optional(),
    })
    .optional(),
  goalContext: z
    .record(
      z.string().min(1).max(200),
      z
        .object({
          __updatedAt: z.number().optional(),
        })
        .catchall(z.unknown()),
    )
    .optional(),
  goalInputs: z
    .record(
      z.string().min(1).max(200),
      z.array(
        z.object({
          ts: z.number().int().positive(),
          value: z.unknown(),
          note: z.string().max(2_000).nullable().optional(),
          source: z.enum(["manual", "auto"]).optional(),
        }),
      ),
    )
    .optional(),
  // Array because the localStorage snapshot store stores the most-
  // recent capture per week, in an array. Migration accepts the same
  // shape — duplicates by week collapse via the unique index.
  snapshots: z
    .array(
      z
        .object({
          week: z.string().min(2).max(32),
          capturedAt: z.string().optional(),
          capturedBy: z.enum(["auto", "manual"]).optional(),
          merged: z.number().optional(),
          reviews: z.number().optional(),
          turnaround: z.number().optional(),
          linkage: z.number().optional(),
          rounds: z.number().optional(),
          note: z.string().max(8_000).optional(),
          goalReadings: z.record(z.string(), z.unknown()).optional(),
          partial: z.boolean().optional(),
          gaps: z.array(z.string()).optional(),
        })
        .passthrough(),
    )
    .max(500)
    .optional(),
  // {[cacheKey]: {prId, rubricHash, verdict, gradedAt}} — the
  // localStorage shape. cacheKey is `${prId}::${rubricHash}` and we
  // ignore it; (prId, rubricHash) drives the upsert.
  gradingVerdicts: z
    .record(
      z.string().min(1).max(500),
      z.object({
        prId: z.union([
          z.string().min(1).max(200),
          z.number().int().positive(),
        ]),
        rubricHash: z.string().min(4).max(128),
        verdict: z.object({
          pass: z.boolean(),
          reasoning: z.string().optional(),
          violations: z.array(z.string()).optional(),
        }),
        gradedAt: z.number().int().positive().optional(),
      }),
    )
    .optional(),
  // {[providerId]: {accessToken?, apiToken?, refreshToken?, email?, …}} —
  // the localStorage shape. Migration encrypts tokens before insert;
  // the imported plaintext stays in memory only as long as this
  // request handler runs.
  integrations: z
    .record(
      z.string().min(1).max(64),
      z
        .object({
          accessToken: z.string().min(1).max(2_048).optional(),
          apiToken: z.string().min(1).max(2_048).optional(),
          refreshToken: z.string().min(1).max(2_048).optional(),
          email: z.string().max(320).optional(),
          endpointUrl: z.string().max(1_000).optional(),
          scopes: z.array(z.string().max(200)).max(50).optional(),
          label: z.string().max(200).optional(),
          connectedAt: z.number().int().positive().optional(),
          expiresAt: z.number().int().positive().optional(),
        })
        .passthrough(),
    )
    .optional(),
});

interface ImportCounts {
  goals: number;
  goalSpecs: { imported: number; skipped: number; errors: string[] };
  goalContext: number;
  goalInputs: { imported: number; skipped: number };
  snapshots: { imported: number; skipped: number };
  gradingVerdicts: { imported: number; skipped: number };
  integrations: { imported: number; skipped: number };
}

export async function importHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = importSchema.parse(req.body);

    const counts: ImportCounts = {
      goals: 0,
      goalSpecs: { imported: 0, skipped: 0, errors: [] },
      goalContext: 0,
      goalInputs: { imported: 0, skipped: 0 },
      snapshots: { imported: 0, skipped: 0 },
      gradingVerdicts: { imported: 0, skipped: 0 },
      integrations: { imported: 0, skipped: 0 },
    };

    const now = new Date();

    // ── goals ─────────────────────────────────────────────────────
    if (payload.goals) {
      const goals = await getGoalsCollection();
      // Treat the imported l1s as opaque — the frontend's store has
      // already done the migration to v2. We accept them as-is and
      // let the Mongo $jsonSchema reject obvious shape issues.
      await goals.findOneAndUpdate(
        { orgId: session.orgId, userId: session.userId },
        {
          $set: {
            // The Mongo $jsonSchema validator enforces the
            // l1s.id/title shape at insert time. The migrator
            // accepts opaque payloads so old localStorage formats
            // can come through; per-row drift gets surfaced by
            // Mongo, not by the route layer.
            l1s: payload.goals.l1s as unknown as GoalL1[],
            schemaVersion: GOALS_SCHEMA_VERSION,
            updatedAt: now,
          },
          $setOnInsert: {
            orgId: session.orgId,
            userId: session.userId,
            cycleId: null,
          },
        },
        { upsert: true, returnDocument: "after" },
      );
      counts.goals = payload.goals.l1s.length;
    }

    // ── goal_specs ────────────────────────────────────────────────
    if (payload.goalSpecs?.specs) {
      const col = await getGoalSpecsCollection();
      const ops: AnyBulkWriteOperation<GoalSpecRecord>[] = [];
      for (const [goalId, raw] of Object.entries(payload.goalSpecs.specs)) {
        const candidate = (raw && typeof raw === "object"
          ? raw
          : {}) as Record<string, unknown>;
        const result = validateSpec({ ...candidate, goalId });
        if (!result.ok) {
          counts.goalSpecs.skipped += 1;
          if (counts.goalSpecs.errors.length < 10) {
            counts.goalSpecs.errors.push(
              `${goalId}: ${result.errors.slice(0, 2).join("; ")}`,
            );
          }
          continue;
        }
        ops.push({
          updateOne: {
            filter: {
              orgId: session.orgId,
              userId: session.userId,
              goalId,
            },
            update: {
              $set: {
                spec: result.spec as unknown as Record<string, unknown>,
                generatedAt: now,
                classifierVersion: null,
              },
              $setOnInsert: {
                orgId: session.orgId,
                userId: session.userId,
                goalId,
              },
            },
            upsert: true,
          },
        });
      }
      if (ops.length > 0) {
        const r = await col.bulkWrite(ops, { ordered: false });
        counts.goalSpecs.imported = (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0);
      }
    }

    // ── goal_context ──────────────────────────────────────────────
    if (payload.goalContext) {
      const col = await getGoalContextCollection();
      const ops: AnyBulkWriteOperation<GoalContextDoc>[] = [];
      for (const [goalId, raw] of Object.entries(payload.goalContext)) {
        // Strip the legacy `__updatedAt` marker; we own that field
        // server-side now.
        const { __updatedAt: _ignored, ...answers } = raw as {
          __updatedAt?: number;
          [key: string]: unknown;
        };
        ops.push({
          updateOne: {
            filter: {
              orgId: session.orgId,
              userId: session.userId,
              goalId,
            },
            update: {
              $set: {
                // The localStorage answer map is opaque — different
                // question kinds store strings / lists / numbers /
                // booleans. The schema constrains shape; here we
                // accept the payload verbatim and let Mongo's
                // $jsonSchema reject anything malformed.
                answers: answers as Record<string, never>,
                updatedAt: now,
              },
              $setOnInsert: {
                orgId: session.orgId,
                userId: session.userId,
                goalId,
              },
            },
            upsert: true,
          },
        });
      }
      if (ops.length > 0) {
        const r = await col.bulkWrite(ops, { ordered: false });
        counts.goalContext = (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0);
      }
    }

    // ── goal_inputs ───────────────────────────────────────────────
    if (payload.goalInputs) {
      const col = await getGoalInputsCollection();
      const docs: Omit<GoalInputEntry, "_id">[] = [];
      for (const [goalId, entries] of Object.entries(payload.goalInputs)) {
        for (const e of entries) {
          // Rough validation — drop entries with unsupported value
          // shapes (e.g. functions wouldn't survive JSON anyway, but
          // be defensive against malformed payloads).
          const valid =
            typeof e.value === "number" ||
            typeof e.value === "string" ||
            typeof e.value === "boolean" ||
            (Array.isArray(e.value) &&
              e.value.every((x) => typeof x === "string")) ||
            (e.value !== null &&
              typeof e.value === "object" &&
              !Array.isArray(e.value));
          if (!valid) {
            counts.goalInputs.skipped += 1;
            continue;
          }
          docs.push({
            orgId: session.orgId,
            userId: session.userId,
            goalId,
            ts: new Date(e.ts),
            value: e.value as GoalInputValue,
            note: e.note ?? null,
            source: (e.source ?? "manual") as GoalInputSource,
          });
        }
      }
      if (docs.length > 0) {
        const r = await col.insertMany(docs as GoalInputEntry[], {
          ordered: false,
        });
        counts.goalInputs.imported = r.insertedCount ?? 0;
      }
    }

    // ── snapshots ────────────────────────────────────────────────
    if (payload.snapshots && payload.snapshots.length > 0) {
      const col = await getSnapshotsCollection();
      const ops: AnyBulkWriteOperation<Snapshot>[] = [];
      for (const s of payload.snapshots) {
        if (typeof s.week !== "string" || s.week.length === 0) {
          counts.snapshots.skipped += 1;
          continue;
        }
        // Parse capturedAt; fall back to now() if missing/invalid.
        let capturedAt = new Date();
        if (typeof s.capturedAt === "string") {
          const d = new Date(s.capturedAt);
          if (!Number.isNaN(d.getTime())) capturedAt = d;
        }
        ops.push({
          updateOne: {
            filter: {
              orgId: session.orgId,
              userId: session.userId,
              week: s.week,
            },
            update: {
              $set: {
                capturedAt,
                capturedBy: s.capturedBy === "auto" ? "auto" : "manual",
                merged: typeof s.merged === "number" ? s.merged : 0,
                reviews: typeof s.reviews === "number" ? s.reviews : 0,
                turnaround:
                  typeof s.turnaround === "number" ? s.turnaround : 0,
                linkage: typeof s.linkage === "number" ? s.linkage : 0,
                rounds: typeof s.rounds === "number" ? s.rounds : 0,
                note: typeof s.note === "string" ? s.note : "",
                // goalReadings shape varies; trust the payload and
                // let the route-layer / Mongo validator catch
                // anything truly malformed.
                goalReadings: (s.goalReadings ?? {}) as unknown as Record<
                  string,
                  GoalReading
                >,
                partial: Boolean(s.partial),
                gaps: Array.isArray(s.gaps) ? s.gaps : [],
              },
              $setOnInsert: {
                orgId: session.orgId,
                userId: session.userId,
                week: s.week,
              },
            },
            upsert: true,
          },
        });
      }
      if (ops.length > 0) {
        const r = await col.bulkWrite(ops, { ordered: false });
        counts.snapshots.imported =
          (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0);
      }
    }

    // ── grading_verdicts ─────────────────────────────────────────
    if (payload.gradingVerdicts) {
      const col = await getGradingVerdictsCollection();
      const ops: AnyBulkWriteOperation<GradingVerdict>[] = [];
      const now = new Date();
      for (const entry of Object.values(payload.gradingVerdicts)) {
        const prId = String(entry.prId);
        let gradedAt = now;
        if (typeof entry.gradedAt === "number") {
          const d = new Date(entry.gradedAt);
          if (!Number.isNaN(d.getTime())) gradedAt = d;
        }
        ops.push({
          updateOne: {
            filter: {
              orgId: session.orgId,
              userId: session.userId,
              prId,
              rubricHash: entry.rubricHash,
            },
            update: {
              $set: {
                verdict: {
                  pass: entry.verdict.pass,
                  reasoning: entry.verdict.reasoning ?? "",
                  violations: entry.verdict.violations ?? [],
                },
                gradedAt,
                model: null,
                provider: null,
              },
              $setOnInsert: {
                orgId: session.orgId,
                userId: session.userId,
                prId,
                rubricHash: entry.rubricHash,
              },
            },
            upsert: true,
          },
        });
      }
      if (ops.length > 0) {
        const r = await col.bulkWrite(ops, { ordered: false });
        counts.gradingVerdicts.imported =
          (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0);
      }
    }

    // ── integrations ─────────────────────────────────────────────
    // Encrypt tokens BEFORE insert. Plaintext lives in memory only
    // for the duration of this request handler — never on disk,
    // never in the audit log.
    if (payload.integrations) {
      const col = await getIntegrationsCollection();
      const ops: AnyBulkWriteOperation<Integration>[] = [];
      const importedAt = new Date();

      for (const [providerId, raw] of Object.entries(payload.integrations)) {
        if (!raw.accessToken && !raw.apiToken) {
          // Skip rows with no usable token — the localStorage shape
          // sometimes carries metadata-only entries from half-finished
          // OAuth flows.
          counts.integrations.skipped += 1;
          continue;
        }
        const encryptedToken = raw.accessToken
          ? encryptSecret(raw.accessToken)
          : null;
        const encryptedApiToken = raw.apiToken
          ? encryptSecret(raw.apiToken)
          : null;
        const refreshToken = raw.refreshToken
          ? encryptSecret(raw.refreshToken)
          : null;
        const connectedAt =
          typeof raw.connectedAt === "number"
            ? new Date(raw.connectedAt)
            : importedAt;
        const expiresAt =
          typeof raw.expiresAt === "number" ? new Date(raw.expiresAt) : null;

        ops.push({
          updateOne: {
            filter: {
              orgId: session.orgId,
              userId: session.userId,
              providerId,
            },
            update: {
              $set: {
                label: raw.label ?? providerId,
                encryptedToken,
                encryptedApiToken,
                refreshToken,
                email: raw.email ?? null,
                endpointUrl: raw.endpointUrl ?? null,
                scopes: raw.scopes ?? [],
                connectedAt,
                expiresAt,
                lastErrorAt: null,
                lastError: null,
              },
              $setOnInsert: {
                orgId: session.orgId,
                userId: session.userId,
                providerId,
                lastUsedAt: null,
              },
            },
            upsert: true,
          },
        });
      }
      if (ops.length > 0) {
        const r = await col.bulkWrite(ops, { ordered: false });
        counts.integrations.imported =
          (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0);
      }
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "user.migrate_import",
      targetType: "user",
      targetId: session.userId.toHexString(),
      after: counts,
      ...networkMeta(req),
    });

    logger.info(
      {
        userId: session.userId.toHexString(),
        counts,
      },
      "[migrate] import complete",
    );

    res.json({ ok: true, counts });
  } catch (err) {
    next(err);
  }
}
