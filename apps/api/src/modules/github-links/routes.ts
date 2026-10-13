/**
 * /api/v1/github-links/* router — an eSpace tracker period ↔ a GitHub issue.
 *
 *   POST   /publish              create one issue per period (claim-first, idempotent)
 *   GET    /?goalId=             the stored links for one goal (no provider call)
 *   GET    /manifests?goalIds=   links for up to 50 goals, keyed by goal
 *   POST   /sync                 read every linked issue back; writes the close reading
 *   GET    /correlation?goalId=  both layers per goal per period, with gap flags
 *   POST   /:linkId/republish    soft-unlink, then publish that one period again
 *   GET    /:linkId/comments     mirrored dev replies + eSpace's posts (owner / manager / asg creator)
 *   POST   /:linkId/comments     post a shared note / tier verdict (manager / asg creator)
 *   DELETE /:linkId              soft unlink — GitHub is never touched
 *
 * `GET /` without goalId returns every live link of the caller (≤ 500).
 *
 * Every route needs a full session. Publish and sync spend the caller's
 * own GitHub quota, so their limiters key on the session user, never the
 * IP (an office behind one NAT must not share a budget) — the same shape
 * as the integrations query routes.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit, { type Options } from "express-rate-limit";
import { HttpError } from "../../middleware/error-handler.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { limiterRetryAfterMs } from "../integrations/query-routes.js";
import {
  correlationHandler,
  listCommentsHandler,
  listHandler,
  postCommentHandler,
  manifestsHandler,
  publishHandler,
  republishHandler,
  syncHandler,
  unlinkHandler,
} from "./controller.js";

function userLimiterOptions(max: number, label: string): Partial<Options> {
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
          `Too many ${label} requests. Wait a few minutes and try again.`,
          undefined,
          limiterRetryAfterMs(req),
        ),
      );
    },
  };
}

/** Publish (and republish): 10 per 15 minutes per user. */
const publishLimiter = rateLimit(userLimiterOptions(10, "publish"));
/** Sync: 30 per 15 minutes per user. */
const syncLimiter = rateLimit(userLimiterOptions(30, "sync"));
/** Comment posts: 20 per 15 minutes per user. */
const commentLimiter = rateLimit(userLimiterOptions(20, "comment"));

export const githubLinksRouter: Router = Router();

githubLinksRouter.post("/publish", requireAuth(), publishLimiter, publishHandler);
githubLinksRouter.get("/", requireAuth(), listHandler);
githubLinksRouter.get("/manifests", requireAuth(), manifestsHandler);
githubLinksRouter.get("/correlation", requireAuth(), correlationHandler);
githubLinksRouter.post("/sync", requireAuth(), syncLimiter, syncHandler);
githubLinksRouter.post("/:linkId/republish", requireAuth(), publishLimiter, republishHandler);
githubLinksRouter.get("/:linkId/comments", requireAuth(), listCommentsHandler);
githubLinksRouter.post("/:linkId/comments", requireAuth(), commentLimiter, postCommentHandler);
githubLinksRouter.delete("/:linkId", requireAuth(), unlinkHandler);
