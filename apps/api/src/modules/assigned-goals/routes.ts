/**
 * /api/v1/assigned-goals/* router — shared goals.
 *
 *   GET    /people                         org directory for the pickers (manager)
 *   POST   /                               create + assign + share (manager)
 *   GET    /?scope=created|viewing         my created goals / goals shared with me
 *   GET    /:id                            meta (creator, viewer or assignee)
 *   PATCH  /:id                            edit (creator)
 *   POST   /:id/archive                    archive (creator)
 *   GET    /:id/progress                   analytics grid (creator or viewer)
 *   GET    /:id/progress/:userId/:periodKey   one cell's values (creator or viewer)
 *   GET    /:id/mine                       my own statuses (assignee, incl. archived)
 *   PUT    /:id/verdicts/:userId           grade an assignee (creator)
 *
 * Creating (and the people directory that feeds it) needs
 * `assigned_goals.manage` (manager + admin roles); every other route authorises per document in the
 * controller, because viewers can sit on any hub.
 */

import { Router } from "express";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import {
  archiveAssignedGoalHandler,
  createAssignedGoalHandler,
  getAssignedGoalHandler,
  getMyProgressHandler,
  putVerdictHandler,
  getProgressCellHandler,
  getProgressHandler,
  listAssignedGoalsHandler,
  listPeopleHandler,
  patchAssignedGoalHandler,
} from "./controller.js";

export const assignedGoalsRouter: Router = Router();

const manager = requireCapability(CAPABILITIES.ASSIGNED_GOALS_MANAGE);

assignedGoalsRouter.get("/people", requireAuth(), manager, listPeopleHandler);
assignedGoalsRouter.post("/", requireAuth(), manager, createAssignedGoalHandler);
assignedGoalsRouter.get("/", requireAuth(), listAssignedGoalsHandler);
assignedGoalsRouter.get("/:id", requireAuth(), getAssignedGoalHandler);
assignedGoalsRouter.patch("/:id", requireAuth(), patchAssignedGoalHandler);
assignedGoalsRouter.post("/:id/archive", requireAuth(), archiveAssignedGoalHandler);
assignedGoalsRouter.get("/:id/progress", requireAuth(), getProgressHandler);
assignedGoalsRouter.get(
  "/:id/progress/:userId/:periodKey",
  requireAuth(),
  getProgressCellHandler,
);
assignedGoalsRouter.get("/:id/mine", requireAuth(), getMyProgressHandler);
assignedGoalsRouter.put("/:id/verdicts/:userId", requireAuth(), putVerdictHandler);
