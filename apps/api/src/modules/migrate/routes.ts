/**
 * /api/v1/migrate/* router.
 *
 *   POST /import   authed — one-shot bulk import of localStorage payload
 *
 * The frontend posts the user's accumulated localStorage data on
 * first authenticated session. Every collection has unique indexes
 * keyed on (orgId, userId, …) so the server-side write is idempotent;
 * a re-post is mostly a no-op (except goal_inputs, which is
 * append-only and would create duplicates — caller's responsibility).
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { importHandler } from "./controller.js";

export const migrateRouter: Router = Router();

migrateRouter.post("/import", requireAuth(), importHandler);
