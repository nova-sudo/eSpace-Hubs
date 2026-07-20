/**
 * /api/v1/notifications/* router — the recipient's own in-app inbox.
 * All routes require a full session; each is scoped to the caller.
 *
 * `/read-all` is declared before `/:id/read` so the literal path isn't
 * swallowed by the `:id` param.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  listNotificationsHandler,
  markAllReadHandler,
  markReadHandler,
} from "./controller.js";

export const notificationsRouter: Router = Router();

notificationsRouter.get("/", requireAuth(), listNotificationsHandler);
notificationsRouter.post("/read-all", requireAuth(), markAllReadHandler);
notificationsRouter.post("/:id/read", requireAuth(), markReadHandler);
