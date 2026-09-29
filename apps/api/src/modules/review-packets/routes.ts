/**
 * /api/v1/review-packets/* router.
 *
 *   POST /      submit the compiled evidence document (new frozen version)
 *   GET  /mine      my submitted versions, newest first (meta only)
 *   GET  /mine/:id  one of my versions with its frozen markdown
 *
 * Full session required. The manager-side reads are on
 * /api/v1/manager/reports/:userId/review-packets (resolveReport-guarded).
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  getMyReviewPacketHandler,
  listMyReviewPacketsHandler,
  submitReviewPacketHandler,
} from "./controller.js";

export const reviewPacketsRouter: Router = Router();

reviewPacketsRouter.post("/", requireAuth(), submitReviewPacketHandler);
reviewPacketsRouter.get("/mine", requireAuth(), listMyReviewPacketsHandler);
reviewPacketsRouter.get("/mine/:id", requireAuth(), getMyReviewPacketHandler);
