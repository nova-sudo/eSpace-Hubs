/**
 * /api/v1/goal-evidence/* router — evidence FILES attached to a goal period.
 *
 *   POST   /:goalId          authed, multipart — attach one file
 *   GET    /:goalId          authed — list this goal's files (?userId= for a
 *                             manager reading a direct report's)
 *   GET    /file/:fileId     authed — download one, always as an attachment
 *   DELETE /file/:fileId     authed — owner only
 *
 * This is the API's SECOND multipart endpoint (the first being
 * /ai/compose-widget/extract). Its middleware is scoped to the one route that
 * needs it for the same reason that one is: `app.ts` parses JSON only, and
 * accepting files here isn't a reason to widen that globally.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit, { type Options } from "express-rate-limit";
import multer from "multer";
import { requireAuth } from "../../middleware/require-auth.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  MAX_EVIDENCE_BYTES,
  deleteEvidenceFileHandler,
  downloadEvidenceFileHandler,
  listEvidenceFilesHandler,
  uploadEvidenceFileHandler,
} from "./controller.js";

/**
 * Keyed per session, not per IP — a whole office behind one NAT shouldn't
 * share an upload budget. 60/hour is far above the "attach three artifacts to
 * this week" shape of real use and far below anything that fills a bucket.
 */
const uploadLimiterOptions: Partial<Options> = {
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.session?.userId?.toHexString() ?? req.ip ?? "anon",
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: "rate_limited",
        message: "Too many uploads. Wait a few minutes and try again.",
      },
    });
  },
};

const evidenceUploadLimiter = rateLimit(uploadLimiterOptions);

/**
 * Memory storage — nothing touches the disk, so there is no path to traverse
 * and no file left behind if the request dies. One file, hard byte cap
 * enforced before a byte reaches GridFS; `fields`/`parts` bounded because the
 * only text part wanted is `periodKey`.
 */
const uploadEvidence = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1, fields: 4, parts: 8 },
}).single("file");

/**
 * multer signals its own limit breaches through the callback rather than by
 * throwing, and surfaces them as a 500 by default. Map what a user can
 * actually cause onto the documented contract and keep multer's own wording
 * out of the response.
 */
function uploadSingleEvidenceFile(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  uploadEvidence(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(
          new HttpError(
            413,
            "file_too_large",
            `That file is over the ${Math.round(MAX_EVIDENCE_BYTES / (1024 * 1024))} MB limit.`,
          ),
        );
      }
      return next(
        new HttpError(
          400,
          "invalid_upload",
          "Attach exactly one file in the `file` field.",
        ),
      );
    }
    return next(new HttpError(400, "invalid_upload", "That upload wasn't readable."));
  });
}

export const goalEvidenceRouter: Router = Router();

// Order matters: auth first (the limiter keys on the session), then the
// limiter (so a flood is rejected before 10 MB is buffered), then multer.
goalEvidenceRouter.post(
  "/:goalId",
  requireAuth(),
  evidenceUploadLimiter,
  uploadSingleEvidenceFile,
  uploadEvidenceFileHandler,
);
// `/file/...` is declared before `/:goalId` would match it — Express takes the
// first match, and "file" is a legal goal id shape.
goalEvidenceRouter.get("/file/:fileId", requireAuth(), downloadEvidenceFileHandler);
goalEvidenceRouter.delete("/file/:fileId", requireAuth(), deleteEvidenceFileHandler);
goalEvidenceRouter.get("/:goalId", requireAuth(), listEvidenceFilesHandler);
