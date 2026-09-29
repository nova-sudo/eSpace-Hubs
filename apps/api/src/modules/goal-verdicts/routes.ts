/**
 * /api/v1/goal-verdicts/* router.
 *
 *   GET  /mine                        the caller's own manager verdicts
 *   GET  /mine/:goalId/history        grade history on one of their goals
 *   POST /mine/:goalId/acknowledge    "Seen" / "I disagree" on the grade
 *
 * Self-scoped; any authenticated user may read — and acknowledge — the
 * manager verdicts written about them. Managers WRITE verdicts through
 * the capability-gated manager module, not here.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { verdictAckLimiter } from "../../middleware/rate-limit.js";
import {
  acknowledgeMyVerdictHandler,
  getMyVerdictHistoryHandler,
  listMyVerdictsHandler,
} from "./controller.js";

export const goalVerdictsRouter: Router = Router();

goalVerdictsRouter.get("/mine", requireAuth(), listMyVerdictsHandler);
goalVerdictsRouter.get(
  "/mine/:goalId/history",
  requireAuth(),
  getMyVerdictHistoryHandler,
);
goalVerdictsRouter.post(
  "/mine/:goalId/acknowledge",
  requireAuth(),
  verdictAckLimiter,
  acknowledgeMyVerdictHandler,
);
