/**
 * /api/v1/goal-specs/* router.
 *
 *   GET     /              authed — list all specs for the user
 *   PUT     /:goalId        authed — upsert one spec (validated)
 *   DELETE  /:goalId        authed — remove one spec
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  deleteGoalSpecHandler,
  listGoalSpecsHandler,
  putGoalSpecHandler,
  submitApprovalHandler,
} from "./controller.js";

export const goalSpecsRouter: Router = Router();

goalSpecsRouter.get("/", requireAuth(), listGoalSpecsHandler);
goalSpecsRouter.put("/:goalId", requireAuth(), putGoalSpecHandler);
goalSpecsRouter.post(
  "/:goalId/submit-approval",
  requireAuth(),
  submitApprovalHandler,
);
goalSpecsRouter.delete("/:goalId", requireAuth(), deleteGoalSpecHandler);
