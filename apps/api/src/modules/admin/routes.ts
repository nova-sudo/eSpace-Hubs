/**
 * /api/v1/admin/* router.
 *
 *   GET   /users           admin: list every user in the org
 *   PATCH /users/:id       admin: edit roles/status/hubs/displayName
 *
 *   GET   /audit           admin: filterable audit-log feed
 *
 * Authorization: every route requires a full session AND the admin
 * role. Same pattern hub-configs follows. Audit-log read intentionally
 * stops at `admin` even though `manager` could conceivably want to
 * see "what did I do" — the M-CAP roadmap reserves a separate
 * capability ("audit.read") for that. Today the admin role is the
 * only audience.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
import {
  listAuditHandler,
  listUsersHandler,
  updateUserHandler,
} from "./controller.js";

export const adminRouter: Router = Router();

adminRouter.get(
  "/users",
  requireAuth(),
  requireRole("admin"),
  listUsersHandler,
);
adminRouter.patch(
  "/users/:id",
  requireAuth(),
  requireRole("admin"),
  updateUserHandler,
);

adminRouter.get(
  "/audit",
  requireAuth(),
  requireRole("admin"),
  listAuditHandler,
);
