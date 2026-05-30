/**
 * /api/v1/evidence/* router.
 *
 *   GET     /         authed — list user's starred items (newest-first)
 *   POST    /         authed — upsert by `id` (toggle on / refresh)
 *   PATCH   /:id      authed — update impact note
 *   DELETE  /:id      authed — toggle off
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  deleteEvidenceHandler,
  listEvidenceHandler,
  patchEvidenceHandler,
  upsertEvidenceHandler,
} from "./controller.js";

export const evidenceRouter: Router = Router();

evidenceRouter.get("/", requireAuth(), listEvidenceHandler);
evidenceRouter.post("/", requireAuth(), upsertEvidenceHandler);
evidenceRouter.patch("/:id", requireAuth(), patchEvidenceHandler);
evidenceRouter.delete("/:id", requireAuth(), deleteEvidenceHandler);
