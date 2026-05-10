/**
 * /api/v1/ai/* router.
 *
 *   POST /chat       authed — short turn against the active provider
 *   POST /grade-pr   authed — single PR rubric grading, JSON verdict
 *
 * Both require a fully-verified session (default). The model never
 * sees the session — it only receives whatever the caller submitted.
 *
 * /classify-goals (the streaming NDJSON analyst) lands in M3.2 when
 * the classifier subsystem moves out of apps/web/src/features/analyst/.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { chatHandler, gradePrHandler } from "./controller.js";

export const aiRouter: Router = Router();

aiRouter.post("/chat", requireAuth(), chatHandler);
aiRouter.post("/grade-pr", requireAuth(), gradePrHandler);
