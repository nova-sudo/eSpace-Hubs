/**
 * /api/v1/goal-spec-meta router.
 *
 *   GET /    { createdAt: { [goalId]: iso }, hireDate: iso | null }
 *
 * Read-only facts ABOUT the user's trackers that the window model needs to
 * decide when each one starts counting (a tracker counts from the day it was
 * created — earlier cadence windows are optional backfill, not "missed").
 * Kept beside /goal-specs rather than inside its payload: the spec is the
 * plan, these are facts about the row.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { getGoalSpecMetaHandler } from "./controller.js";

export const goalSpecMetaRouter: Router = Router();

goalSpecMetaRouter.get("/", requireAuth(), getGoalSpecMetaHandler);
