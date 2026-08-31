/**
 * /api/v1/goals/* router.
 *
 *   GET  /            authed — return the user's goal tree (auto-empty if none)
 *   PUT  /            authed — upsert the entire tree (optionally archiving
 *                     the outgoing one — see archiveCurrent in schemas.ts)
 *   GET  /cycles      authed — archived prior trees, meta only
 *   GET  /cycles/:id  authed — one archived tree, read-only, in full
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  getGoalCycleHandler,
  getGoalsHandler,
  listGoalCyclesHandler,
  putGoalsHandler,
} from "./controller.js";

export const goalsRouter: Router = Router();

goalsRouter.get("/", requireAuth(), getGoalsHandler);
goalsRouter.put("/", requireAuth(), putGoalsHandler);
goalsRouter.get("/cycles", requireAuth(), listGoalCyclesHandler);
goalsRouter.get("/cycles/:id", requireAuth(), getGoalCycleHandler);
