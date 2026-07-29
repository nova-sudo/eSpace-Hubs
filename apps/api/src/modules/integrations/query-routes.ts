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
  getGoalContextCollection,
  getGoalSpecsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import { DEFAULT_ENGAGEMENT, type Engagement } from "../../db/types.js";
import { HttpError } from "../../middleware/error-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { resolveQuery } from "./query-runner.js";

/**
 * 30 per 15 minutes. A tracker tops out at 10 fields, so a user opening
 * a widget and refreshing it a couple of times stays well inside; a loop
 * burning GitHub's hourly quota does not.
 */
const queryFieldLimiterOptions: Partial<Options> = {
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req: Request) =>
    req.session?.userId.toHexString() ?? "unauthenticated",
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new HttpError(
        429,
        "rate_limited",
        "Too many auto-fill refreshes. Wait a few minutes and try again.",
      ),
    );
  },
};
const queryFieldLimiter = rateLimit(queryFieldLimiterOptions);

/**
 * `periodKey` narrows the lookup to one authored period's field list —
 * per-period COMPOSED content can redefine `fields`, so the same field id
 * may exist twice with different sources.
 */
const queryFieldSchema = z
  .object({
    goalId: z.string().min(1).max(200),
    fieldId: z.string().min(1).max(200),
    periodKey: z.string().min(1).max(200).optional(),
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
 * Find the field by id — inside the named period when one is given, else
 * at the widget level with the periods as fallback. Deliberately returns
 * the FIRST match: duplicate ids inside one field list are rejected by
 * the spec validator, so a collision here can only be widget-vs-period,
 * where the period is the more specific answer.
 */
function findFieldSource(
  spec: Record<string, unknown>,
  fieldId: string,
  periodKey: string | undefined,
): unknown {
  const periods = (spec?.["composed"] as { periods?: unknown } | undefined)
    ?.periods;
  const periodList = Array.isArray(periods) ? periods : [];

  const search: unknown[] = periodKey
    ? periodList.filter((p) => (p as { key?: unknown })?.key === periodKey)
    : [spec, ...periodList];

  for (const container of search) {
    for (const field of fieldList(container)) {
      if (field?.id === fieldId && field.source != null) return field.source;
    }
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
    const { goalId, fieldId, periodKey } = queryFieldSchema.parse(req.body);

    // Org-scoped AND user-scoped: a spec belongs to the dev who owns the
    // goal, and the token we are about to spend is theirs too.
    const specs = await getGoalSpecsCollection();
    const specDoc = await specs.findOne({
      orgId: session.orgId,
      userId: session.userId,
      goalId,
    });
    if (!specDoc?.spec) {
      throw new HttpError(404, "spec_not_found", "This tracker no longer exists.");
    }

    const source = findFieldSource(specDoc.spec, fieldId, periodKey);
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

export const queryFieldRouter: Router = Router();

// Auth first (the limiter keys on the session), then the limiter, so a
// flood is rejected before it costs a Mongo read.
queryFieldRouter.post(
  "/query-field",
  requireAuth(),
  queryFieldLimiter,
  queryFieldHandler,
);
