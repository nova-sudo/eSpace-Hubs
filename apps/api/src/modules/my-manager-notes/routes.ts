/**
 * /api/v1/my-manager-notes router.
 *
 *   GET /    notes my manager(s) wrote about me and shared with me,
 *            newest first: { notes: [{ id, body, visibility,
 *            managerName, createdAt, updatedAt }] }
 *
 * Self-scoped (`reportId === session.userId`), `requireAuth()` only — any
 * signed-in user may read what was shared with them; someone with no
 * shared notes gets an empty list.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { listMyManagerNotesHandler } from "./controller.js";

export const myManagerNotesRouter: Router = Router();

myManagerNotesRouter.get("/", requireAuth(), listMyManagerNotesHandler);
