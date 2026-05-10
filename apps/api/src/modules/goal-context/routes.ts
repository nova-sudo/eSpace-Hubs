/**
 * /api/v1/goal-context/* router.
 *
 *   GET     /              authed — list answers for every goal
 *   PUT     /:goalId        authed — partial-merge answers (null deletes a key)
 *   DELETE  /:goalId        authed — clear all answers for a goal
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  deleteGoalContextHandler,
  listGoalContextHandler,
  putGoalContextHandler,
} from "./controller.js";

export const goalContextRouter: Router = Router();

goalContextRouter.get("/", requireAuth(), listGoalContextHandler);
goalContextRouter.put("/:goalId", requireAuth(), putGoalContextHandler);
goalContextRouter.delete("/:goalId", requireAuth(), deleteGoalContextHandler);
