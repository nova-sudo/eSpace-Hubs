/**
 * /api/v1/goal-locks/* router.
 *
 *   GET /    the user's settle-lock keys
 *   PUT /    partial update — { set?: string[], clear?: string[] }
 *
 * Full session required (default requireAuth) — locks feed the
 * achievement-tier consistency cap, which is grading-relevant state.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  listGoalLocksHandler,
  putGoalLocksHandler,
} from "./controller.js";

export const goalLocksRouter: Router = Router();

goalLocksRouter.get("/", requireAuth(), listGoalLocksHandler);
goalLocksRouter.put("/", requireAuth(), putGoalLocksHandler);
