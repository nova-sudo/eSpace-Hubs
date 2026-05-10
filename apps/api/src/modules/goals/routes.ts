/**
 * /api/v1/goals/* router.
 *
 *   GET  /   authed — return the user's goal tree (auto-empty if none)
 *   PUT  /   authed — upsert the entire tree
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { getGoalsHandler, putGoalsHandler } from "./controller.js";

export const goalsRouter: Router = Router();

goalsRouter.get("/", requireAuth(), getGoalsHandler);
goalsRouter.put("/", requireAuth(), putGoalsHandler);
