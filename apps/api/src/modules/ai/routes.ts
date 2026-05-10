/**
 * /api/v1/ai/* router.
 *
 *   POST /chat              authed — short turn against the active provider
 *   POST /grade-pr          authed — single PR rubric grading, JSON verdict
 *   POST /classify-goals    authed — streaming NDJSON: one AnalysisEvent
 *                            per line, bounded-concurrency per-goal calls
 *
 * All require a fully-verified session (default). The model never sees
 * the session — it only receives whatever the caller submitted.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { chatHandler, gradePrHandler } from "./controller.js";
import { classifyGoalsHandler } from "./classify-controller.js";

export const aiRouter: Router = Router();

aiRouter.post("/chat", requireAuth(), chatHandler);
aiRouter.post("/grade-pr", requireAuth(), gradePrHandler);
// /classify-goals — NDJSON stream (one AnalysisEvent per line).
// Auth runs as middleware; once headers flush, the handler owns the
// response and never throws into express's error handler.
aiRouter.post("/classify-goals", requireAuth(), classifyGoalsHandler);
