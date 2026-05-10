/**
 * /api/v1/goal-inputs/* router.
 *
 *   GET     /                    authed — list, optional ?goalId, ?since, ?until, ?limit
 *   POST    /                    authed — append one entry
 *   DELETE  /:entryId             authed — remove one entry
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  appendGoalInputHandler,
  deleteGoalInputHandler,
  listGoalInputsHandler,
} from "./controller.js";

export const goalInputsRouter: Router = Router();

goalInputsRouter.get("/", requireAuth(), listGoalInputsHandler);
goalInputsRouter.post("/", requireAuth(), appendGoalInputHandler);
goalInputsRouter.delete("/:entryId", requireAuth(), deleteGoalInputHandler);
