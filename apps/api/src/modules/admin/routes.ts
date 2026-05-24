/**
 * /api/v1/admin/* router.
 *
 *   GET   /users                       admin: list every user in the org
 *   PATCH /users/:id                   admin: edit roles/status/hubs/displayName
 *   POST  /users/:id/totp/reset        admin: clear a user's TOTP enrolment
 *                                       (admin-side recovery for lost
 *                                       authenticators; not allowed on self)
 *
 *   GET   /signup-codes                admin: list org's self-serve signup codes
 *   POST  /signup-codes                admin: mint a new signup code
 *   PATCH /signup-codes/:code          admin: enable / disable a code
 *
 *   GET   /audit                       admin: filterable audit-log feed
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
  createSignupCodeHandler,
  listAuditHandler,
  listSignupCodesHandler,
  listUsersHandler,
  resetUserPersonalDataHandler,
  resetUserTotpHandler,
  updateSignupCodeHandler,
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
adminRouter.post(
  "/users/:id/totp/reset",
  requireAuth(),
  requireRole("admin"),
  resetUserTotpHandler,
);
// Wipes the user's dashboard data (goals + snapshots + verdicts +
// specs + context + inputs) across the collections that were polluted
// by the pre-#117 localStorage-mirror upload bug. Does NOT delete the
// user account, integrations, sessions, or audit history.
adminRouter.delete(
  "/users/:id/personal-data",
  requireAuth(),
  requireRole("admin"),
  resetUserPersonalDataHandler,
);

adminRouter.get(
  "/signup-codes",
  requireAuth(),
  requireRole("admin"),
  listSignupCodesHandler,
);
adminRouter.post(
  "/signup-codes",
  requireAuth(),
  requireRole("admin"),
  createSignupCodeHandler,
);
adminRouter.patch(
  "/signup-codes/:code",
  requireAuth(),
  requireRole("admin"),
  updateSignupCodeHandler,
);

adminRouter.get(
  "/audit",
  requireAuth(),
  requireRole("admin"),
  listAuditHandler,
);
