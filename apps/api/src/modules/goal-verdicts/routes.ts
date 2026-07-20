/**
 * /api/v1/goal-verdicts/* router.
 *
 *   GET /mine   the caller's own manager verdicts (dev-hub hydration)
 *
 * Read-only + self-scoped; any authenticated user may read the manager
 * verdicts written about them. Managers WRITE verdicts through the
 * capability-gated manager module, not here.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { listMyVerdictsHandler } from "./controller.js";

export const goalVerdictsRouter: Router = Router();

goalVerdictsRouter.get("/mine", requireAuth(), listMyVerdictsHandler);
