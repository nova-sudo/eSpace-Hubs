/**
 * /api/v1/tier-policies/* router.
 *
 *   GET /mine   manager tier policies resolved against the caller's own
 *               L1 Goal Codes (dev-hub hydration)
 *
 * Read-only + self-scoped. Managers WRITE policies through the
 * capability-gated manager module, not here.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { listMyTierPoliciesHandler } from "./controller.js";

export const tierPoliciesRouter: Router = Router();

tierPoliciesRouter.get("/mine", requireAuth(), listMyTierPoliciesHandler);
