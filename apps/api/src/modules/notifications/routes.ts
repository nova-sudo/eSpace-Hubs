/**
 * /api/v1/notifications/* router — the recipient's own in-app inbox.
 * All routes require a full session; each is scoped to the caller.
 *
 * `/read-all` is declared before `/:id/read` so the literal path isn't
 * swallowed by the `:id` param. `/preferences` is the caller's own
 * mute / email settings (Settings → Notifications).
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  getPreferencesHandler,
  listNotificationsHandler,
  putPreferencesHandler,
  markAllReadHandler,
  markReadHandler,
} from "./controller.js";

export const notificationsRouter: Router = Router();

notificationsRouter.get("/", requireAuth(), listNotificationsHandler);
notificationsRouter.get("/preferences", requireAuth(), getPreferencesHandler);
notificationsRouter.put("/preferences", requireAuth(), putPreferencesHandler);
notificationsRouter.post("/read-all", requireAuth(), markAllReadHandler);
notificationsRouter.post("/:id/read", requireAuth(), markReadHandler);
