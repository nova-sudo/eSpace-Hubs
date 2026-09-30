/**
 * POST /api/v1/integrations/query-field — fill ONE COMPOSED field from
 * the provider the field's template names.
 *
 * The single most important line in this file is what the body schema
 * does NOT accept: a `source`. If the client could post one, the whole
 * template allowlist would be decoration — the browser (or anything that
 * got a session) could name any template with any params. So the request
 * identifies a goal + field, and the server reads the source out of the
 * stored, already-validated spec. `.strict()` makes a stray `source` key
 * a 400 rather than something silently ignored, because "silently
 * ignored" is how that mistake survives a refactor.
 *
 * Context answers come from storage for the same reason, and are still
 * treated as hostile input by the runner — persistence is not validation.
 *
 * Rate limiting: session-keyed, not IP-keyed. Every call here spends a
 * third-party API quota that belongs to ONE user's token, so an office
 * behind a single NAT must not share a budget. Shaped after the limiter
 * in modules/ai/routes.ts, for the same reason it exists there: the
 * factory in middleware/rate-limit.ts is IP-keyed by construction.
 */

import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit, { type Options } from "express-rate-limit";
import { z } from "zod";
import {
  MANAGEMENT_PATH_SEGMENT,
  resolveContentAtPath,
  type WindowPathSegment,
} from "@espace-devhub/shared/goal-specs";
import {
  getGoalContextCollection,
  getGoalSpecsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import { assignedSpecRecordFor } from "../../lib/assigned-goals.js";
import { isAssignedGoalId } from "@espace-devhub/shared/goal-specs";
import { DEFAULT_ENGAGEMENT, type Engagement } from "../../db/types.js";
import { HttpError } from "../../middleware/error-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { resolveQuery } from "./query-runner.js";

/**
 * How long until this limiter's window reopens for the caller, in ms —
 * from the `req.rateLimit` info express-rate-limit attaches. Carried on the
 * 429 as `error.retryAfterMs` (+ `Retry-After`) so the client can say
 * "try again in 4 min" and back off instead of retrying blind.
 */
export function limiterRetryAfterMs(req: Request, now = Date.now()): number | undefined {
  const reset = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
  if (!(reset instanceof Date)) return undefined;
  return Math.max(1_000, reset.getTime() - now);
}

function queryLimiterOptions(max: number): Partial<Options> {
  return {
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    keyGenerator: (req: Request) =>
      req.session?.userId.toHexString() ?? "unauthenticated",
    handler: (req: Request, _res: Response, next: NextFunction) => {
      next(
        new HttpError(
          429,
          "rate_limited",
          "Too many auto-fill refreshes. Wait a few minutes and try again.",
          undefined,
          limiterRetryAfterMs(req),
        ),
      );
    },
  };
}

/**
 * Single-field route: 60 per 15 minutes (was 30 — one composed tracker
 * holds up to 10 auto fields plus nested and management blocks, so opening
 * three trackers used to exhaust it). Current clients batch a whole window
 * through /query-fields instead; this stays for older bundles and Retry.
 */
const queryFieldLimiter = rateLimit(queryLimiterOptions(60));
/**
 * Batch route: 30 WINDOWS per 15 minutes. One request fills every auto
 * field of one window, so the budget counts forms opened, not fields.
 * Separate bucket from the single-field route.
 */
const queryFieldsLimiter = rateLimit(queryLimiterOptions(30));

/**
 * `periodPath` is how the client says WHICH form the field belongs to —
 * `[3]` is window 3 of the top-level cadence, `[0, 2]` is week 2 inside
 * quarter 0, `["management", 1]` is window 1 of the management plan. It
 * carries positions, never a source, so it can't widen what the browser is
 * allowed to ask for: the worst a forged path can do is resolve a different
 * period of the caller's OWN spec, every part of which the server was already
 * willing to run for them.
 *
 * `periodKey` is the storage key for the same window ("2026-Q3",
 * "2026-Q1::2026-W3"). It stays accepted — and stays unused for resolution —
 * because it is a CALENDAR key, unrelated to the positional period list; see
 * the note on `findFieldSource`.
 */
const queryFieldSchema = z
  .object({
    goalId: z.string().min(1).max(200),
    fieldId: z.string().min(1).max(200),
    periodKey: z.string().min(1).max(200).optional(),
    periodPath: z
      .array(
        z.union([
          z.number().int().min(-1).max(1000),
          z.literal(MANAGEMENT_PATH_SEGMENT),
        ]),
      )
      .max(12)
      .optional(),
  })
  .strict();

interface FieldLike {
  id?: unknown;
  source?: unknown;
}

function fieldList(container: unknown): FieldLike[] {
  const fields = (container as { fields?: unknown })?.fields;
  return Array.isArray(fields) ? (fields as FieldLike[]) : [];
}

/**
 * Find the query source for ONE field of a COMPOSED spec.
 *
 * `periodPath` is what makes this answerable. A spec's fields are not all in
 * `spec.fields`: a period can redefine them, a nested cadence carries its own
 * set, and the management half is a second tree — and ids are only unique
 * within one of those lists (`f1` is handed out per list). So the client sends
 * the positional address of the form it is rendering and the server resolves
 * the SAME window content the client did, out of the stored spec. Searching
 * the tree for an id instead would eventually run a different period's query
 * under this period's label, which is the failure you never notice.
 *
 * `periodKey` deliberately plays no part. It names a stored ENTRY's cadence
 * window — a calendar-derived key like "2026-Q3", produced by apps/web's
 * cadence-windows.js — while `composed.periods[].key` is an unrelated
 * author-chosen slug the compose AI invents ("w1", "m2"). The two are
 * different namespaces and essentially never coincide; matching periods by
 * key is what turned "field isn't auto-filled" into the default outcome for
 * every cadenced tracker once (see query-routes.test.ts).
 *
 * Without a path — a browser still running a bundle from before this shipped
 * — the lookup falls back to the widget-level `spec.fields`, which is exactly
 * the behaviour those clients already had.
 */
export function findFieldSource(
  spec: Record<string, unknown>,
  fieldId: string,
  periodPath?: WindowPathSegment[],
): unknown {
  const scoped = periodPath?.length
    ? resolveContentAtPath(spec, periodPath)
    : null;
  // A path that resolved is the ONLY list consulted: if this window's `f1` is
  // a typed field, the widget-level `f1` is a different question, not a
  // fallback answer.
  const fields = periodPath?.length ? (scoped?.fields ?? []) : fieldList(spec);
  for (const field of fields as FieldLike[]) {
    if (field?.id === fieldId && field.source != null) return field.source;
  }
  return null;
}

export async function queryFieldHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { goalId, fieldId, periodPath } = queryFieldSchema.parse(req.body);

    // Org-scoped AND user-scoped: a spec belongs to the dev who owns the
    // goal, and the token we are about to spend is theirs too.
    // A shared goal's spec isn't stored per user — it's the assigned goal's
    // plan, readable only by its assignees. The query still spends the
    // assignee's own token against their own repos.
    const specDoc = isAssignedGoalId(goalId)
      ? await assignedSpecRecordFor(session.orgId, session.userId, goalId)
      : await (await getGoalSpecsCollection()).findOne({
          orgId: session.orgId,
          userId: session.userId,
          goalId,
        });
    if (!specDoc?.spec) {
      throw new HttpError(404, "spec_not_found", "This tracker no longer exists.");
    }

    const source = findFieldSource(specDoc.spec, fieldId, periodPath);
    if (!source) {
      throw new HttpError(
        400,
        "field_not_auto_filled",
        "This field isn't filled from a connected tool.",
      );
    }

    const contextCol = await getGoalContextCollection();
    const contextDoc = await contextCol.findOne({
      orgId: session.orgId,
      userId: session.userId,
      goalId,
    });

    const users = await getUsersCollection();
    const user = await users.findOne(
      { _id: session.userId },
      { projection: { engagement: 1 } },
    );
    const engagement = (user?.engagement ?? DEFAULT_ENGAGEMENT) as Engagement;

    const result = await resolveQuery(source, {
      userId: session.userId,
      orgId: session.orgId,
      engagement,
      contextAnswers: contextDoc?.answers ?? {},
    });

    res.json({ goalId, fieldId, ...result });
  } catch (err) {
    next(err);
  }
}

/** Most auto fields one batch may name — a window tops out at 10 today. */
export const MAX_BATCH_FIELDS = 20;

const queryFieldsSchema = z
  .object({
    goalId: z.string().min(1).max(200),
    fieldIds: z.array(z.string().min(1).max(200)).min(1).max(MAX_BATCH_FIELDS),
    periodKey: z.string().min(1).max(200).optional(),
    periodPath: queryFieldSchema.shape.periodPath,
  })
  .strict();

/** A per-field failure in the batch reply — the single route's error envelope. */
function fieldError(err: unknown): { ok: false; status: number; error: { code: string; message: string } } {
  if (err instanceof HttpError) {
    return { ok: false, status: err.status, error: { code: err.code, message: err.message } };
  }
  return {
    ok: false,
    status: 500,
    error: { code: "query_failed", message: "Couldn't read this field." },
  };
}

/**
 * POST /integrations/query-fields — fill EVERY auto field of one window in
 * one request (one limiter slot). Same trust model as /query-field: the body
 * names goal + fields + window position, never a source; each source is read
 * from the stored spec. Fields resolve one after another (the runner already
 * serialises its own per-repo fan-out) and fail independently — the reply is
 * `{ goalId, results: { [fieldId]: <single-route body> | { ok:false, status,
 * error } } }`, so one broken repo lookup never hides its neighbours.
 */
export async function queryFieldsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { goalId, fieldIds, periodPath } = queryFieldsSchema.parse(req.body);

    const specDoc = isAssignedGoalId(goalId)
      ? await assignedSpecRecordFor(session.orgId, session.userId, goalId)
      : await (await getGoalSpecsCollection()).findOne({
          orgId: session.orgId,
          userId: session.userId,
          goalId,
        });
    if (!specDoc?.spec) {
      throw new HttpError(404, "spec_not_found", "This tracker no longer exists.");
    }

    const contextCol = await getGoalContextCollection();
    const contextDoc = await contextCol.findOne({
      orgId: session.orgId,
      userId: session.userId,
      goalId,
    });
    const users = await getUsersCollection();
    const user = await users.findOne(
      { _id: session.userId },
      { projection: { engagement: 1 } },
    );
    const engagement = (user?.engagement ?? DEFAULT_ENGAGEMENT) as Engagement;

    const results: Record<string, unknown> = {};
    for (const fieldId of [...new Set(fieldIds)]) {
      const source = findFieldSource(specDoc.spec, fieldId, periodPath);
      if (!source) {
        results[fieldId] = fieldError(
          new HttpError(400, "field_not_auto_filled", "This field isn't filled from a connected tool."),
        );
        continue;
      }
      try {
        const result = await resolveQuery(source, {
          userId: session.userId,
          orgId: session.orgId,
          engagement,
          contextAnswers: contextDoc?.answers ?? {},
        });
        results[fieldId] = { goalId, fieldId, ...result };
      } catch (err) {
        results[fieldId] = fieldError(err);
      }
    }
    res.json({ goalId, results });
  } catch (err) {
    next(err);
  }
}

export const queryFieldRouter: Router = Router();

// Auth first (the limiter keys on the session), then the limiter, so a
// flood is rejected before it costs a Mongo read.
queryFieldRouter.post(
  "/query-field",
  requireAuth(),
  queryFieldLimiter,
  queryFieldHandler,
);
queryFieldRouter.post(
  "/query-fields",
  requireAuth(),
  queryFieldsLimiter,
  queryFieldsHandler,
);
