/**
 * /api/v1/ai/* router.
 *
 *   POST /chat              authed — short turn against the active provider
 *   POST /grade-pr          authed — single PR rubric grading, JSON verdict
 *   POST /classify-goals    authed — streaming NDJSON: one AnalysisEvent
 *                            per line, bounded-concurrency per-goal calls
 *   POST /compose-widget/extract
 *                           authed — the app's ONLY multipart endpoint;
 *                            document bytes in, plain text out
 *
 * All require a fully-verified session (default). The model never sees
 * the session — it only receives whatever the caller submitted.
 *
 * The extract route is the one place in the API that accepts something
 * other than JSON, so its middleware is scoped to that single line
 * rather than mounted on the router: `app.ts` deliberately parses JSON
 * only, and this feature is not a reason to widen that globally.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit, { type Options } from "express-rate-limit";
import multer from "multer";
import { requireAuth } from "../../middleware/require-auth.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  chatHandler,
  gradePrHandler,
  gradeGoalTierHandler,
  listGoalTierVerdictsHandler,
  composeWidgetHandler,
  extractAttachmentHandler,
} from "./controller.js";
import { classifyGoalsHandler } from "./classify-controller.js";
// From the leaf `limits` module, never ./extract/index.js — that one reaches
// run-in-worker.ts's `new Worker(...)`, which Turbopack can't statically
// analyse, and this router is transitively reachable from apps/web's Next
// catch-all route. Importing it here breaks the web build.
import { MAX_UPLOAD_BYTES } from "./extract/limits.js";

/**
 * W5 — a parse is orders of magnitude more expensive than the JSON POSTs
 * the rest of this router serves, and the API is a single process, so the
 * upload path gets its own limiter.
 *
 * Shaped exactly like the factory in `middleware/rate-limit.ts` (same
 * draft-7 headers, same HttpError envelope) but keyed on the session user
 * rather than the IP: everything here runs behind `requireAuth`, and a
 * whole office behind one NAT shouldn't share an upload budget. That
 * factory is private to its module and IP-keyed by construction; when it
 * grows a key option this should collapse back into it.
 */
const uploadLimiterOptions: Partial<Options> = {
  windowMs: 15 * 60 * 1000,
  max: 8,
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
        "Too many document uploads. Wait a few minutes and try again.",
      ),
    );
  },
};
const documentUploadLimiter = rateLimit(uploadLimiterOptions);

/**
 * The compose route needs its own budget, and it is arguably the more
 * important of the two: extraction is local, deterministic and free, while
 * /compose-widget bills an upstream provider per token — and it now accepts a
 * 20,000-character attachment. A caller who exhausts the upload budget (or
 * skips extraction entirely and pastes text straight into `attachment`) would
 * otherwise still be able to hammer the expensive route unmetered.
 *
 * Deliberately looser than the upload limiter: composing is the thing users
 * legitimately retry while refining a description.
 */
const composeLimiterOptions: Partial<Options> = {
  ...uploadLimiterOptions,
  max: 20,
  handler: (_req: Request, _res: Response, next: NextFunction) => {
    next(
      new HttpError(
        429,
        "rate_limited",
        "Too many tracker generations. Wait a few minutes and try again.",
      ),
    );
  },
};
const composeWidgetLimiter = rateLimit(composeLimiterOptions);

/**
 * W7 — memory storage (nothing ever hits the disk, so there is no path to
 * traverse and no file to leave behind), one file, hard byte cap enforced
 * by multer before a single byte reaches a parser. `fields`/`parts` are
 * bounded too: the only text part we want is `goalId`.
 */
const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, parts: 8 },
}).single("file");

/**
 * multer reports its own limit breaches through the callback, not by
 * throwing, and its default surfacing is a 500. Map the ones a user can
 * actually cause onto the documented contract (413 / 400) and keep the
 * raw multer message out of the response.
 */
function uploadSingleDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  uploadDocument(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(
          new HttpError(
            413,
            "file_too_large",
            `That file is over the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
          ),
        );
      }
      return next(
        new HttpError(
          400,
          "invalid_upload",
          "Attach exactly one document in the `file` field.",
        ),
      );
    }
    return next(
      new HttpError(400, "invalid_upload", "That upload wasn't readable."),
    );
  });
}

export const aiRouter: Router = Router();

aiRouter.post("/chat", requireAuth(), chatHandler);
aiRouter.post("/grade-pr", requireAuth(), gradePrHandler);
// Score which achievement tier a developer is at for one goal, given the
// goal's classifier-distilled tier criteria + its current metric data.
aiRouter.post("/grade-goal-tier", requireAuth(), gradeGoalTierHandler);
// "Describe your own tracker" → a COMPOSED spec built from the user's text
// (plus, optionally, text extracted from a document they attached).
aiRouter.post(
  "/compose-widget",
  requireAuth(),
  composeWidgetLimiter,
  composeWidgetHandler,
);
// Read an attached PDF/DOCX/XLSX/CSV into plain text. Order matters: auth
// first (the limiter keys on the session), then the limiter (so a flood
// is rejected before we buffer 10 MB), then multer, then the handler.
aiRouter.post(
  "/compose-widget/extract",
  requireAuth(),
  documentUploadLimiter,
  uploadSingleDocument,
  extractAttachmentHandler,
);
// Hydrate all persisted tier verdicts for the user in one request (page load).
aiRouter.get("/goal-tier-verdicts", requireAuth(), listGoalTierVerdictsHandler);
// /classify-goals — NDJSON stream (one AnalysisEvent per line).
// Auth runs as middleware; once headers flush, the handler owns the
// response and never throws into express's error handler.
aiRouter.post("/classify-goals", requireAuth(), classifyGoalsHandler);
