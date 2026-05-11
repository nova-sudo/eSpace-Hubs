/**
 * /api/v1/hubs/* router.
 *
 *   GET /me   authed — returns the hubs the current user can access,
 *                       their primary hub, and the registry's default.
 *
 * No write surface here yet. Updating a user's allowedHubs / primaryHub
 * is an admin / onboarding-flow concern that lands in M10.5 (admin
 * config) and M-OB (onboarding). The registry itself is code-only
 * for M10.1; M10.5 layers an overrides collection on top.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { listMyHubsHandler } from "./controller.js";

export const hubsRouter: Router = Router();

hubsRouter.get("/me", requireAuth(), listMyHubsHandler);
