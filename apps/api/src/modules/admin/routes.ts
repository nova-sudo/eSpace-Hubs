/**
 * /api/v1/admin/* router.
 *
 *   GET    /users                         paginated roster, server-side
 *                                         search + filters     [users.manage]
 *   GET    /users/summary                 overview counts      [users.manage]
 *   GET    /users/directory               lightweight roster for pickers
 *                                         + name lookups  [users.manage | audit.view]
 *   PATCH  /users/:id                     roles/status/hubs/name/manager
 *                                                              [users.manage]
 *   POST   /users/:id/reassign-reports    move all of :id's reports
 *                                                              [users.manage]
 *   POST   /users/:id/totp/reset          clear a user's TOTP  [users.manage]
 *   DELETE /users/:id/personal-data       wipe dashboard data  [users.manage]
 *   GET    /org-chart                     reporting tree + flags [users.manage]
 *
 *   GET    /signup-codes · POST · PATCH /signup-codes/:code  [users.manage]
 *
 *   GET    /audit                         filterable feed      [audit.view]
 *   GET    /audit/export.csv              same filters, as CSV [audit.view]
 *
 *   GET    /approvals                     BYO approvals with no active
 *                                         manager               [hub.admin]
 *   POST   /approvals/:userId/:goalId     approve / request changes
 *                                                                [hub.admin]
 *
 * Authorization (hub-audit §2.1/§2.2): each route names the granular
 * admin capability it needs — `admin.users.manage`, `admin.audit.view` —
 * checked server-side by `requireCapability`, which re-reads the user on
 * every request (a revoked role stops working immediately). The approvals
 * queue needs only `hub.admin.access`: any admin may decide an approval
 * that has no manager to route to.
 */

import { Router } from "express";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  requireAnyCapability,
  requireCapability,
} from "../../middleware/require-capability.js";
import {
  createSignupCodeHandler,
  listAuditHandler,
  listSignupCodesHandler,
  resetUserPersonalDataHandler,
  resetUserTotpHandler,
  updateSignupCodeHandler,
  updateUserHandler,
} from "./controller.js";
import {
  directoryHandler,
  listUsersHandler,
  orgChartHandler,
  reassignReportsHandler,
  usersSummaryHandler,
} from "./roster-controller.js";
import {
  decideAdminApprovalHandler,
  listAdminApprovalsHandler,
} from "./approvals-controller.js";
import { exportAuditCsvHandler } from "./audit-export.js";

export const adminRouter: Router = Router();

const usersManage = requireCapability(CAPABILITIES.ADMIN_USERS_MANAGE);
const auditView = requireCapability(CAPABILITIES.ADMIN_AUDIT_VIEW);
const adminHub = requireCapability(CAPABILITIES.HUB_ADMIN_ACCESS);

// Literal paths before `/users/:id…` so they aren't read as ids.
adminRouter.get("/users", requireAuth(), usersManage, listUsersHandler);
adminRouter.get("/users/summary", requireAuth(), usersManage, usersSummaryHandler);
adminRouter.get(
  "/users/directory",
  requireAuth(),
  requireAnyCapability(
    CAPABILITIES.ADMIN_USERS_MANAGE,
    CAPABILITIES.ADMIN_AUDIT_VIEW,
  ),
  directoryHandler,
);
adminRouter.patch("/users/:id", requireAuth(), usersManage, updateUserHandler);
adminRouter.post(
  "/users/:id/reassign-reports",
  requireAuth(),
  usersManage,
  reassignReportsHandler,
);
adminRouter.post(
  "/users/:id/totp/reset",
  requireAuth(),
  usersManage,
  resetUserTotpHandler,
);
// Wipes the user's dashboard data (goals + snapshots + verdicts +
// specs + context + inputs) across the collections that were polluted
// by the pre-#117 localStorage-mirror upload bug. Does NOT delete the
// user account, integrations, sessions, or audit history.
adminRouter.delete(
  "/users/:id/personal-data",
  requireAuth(),
  usersManage,
  resetUserPersonalDataHandler,
);
adminRouter.get("/org-chart", requireAuth(), usersManage, orgChartHandler);

adminRouter.get("/signup-codes", requireAuth(), usersManage, listSignupCodesHandler);
adminRouter.post("/signup-codes", requireAuth(), usersManage, createSignupCodeHandler);
adminRouter.patch(
  "/signup-codes/:code",
  requireAuth(),
  usersManage,
  updateSignupCodeHandler,
);

adminRouter.get("/audit", requireAuth(), auditView, listAuditHandler);
adminRouter.get("/audit/export.csv", requireAuth(), auditView, exportAuditCsvHandler);

adminRouter.get("/approvals", requireAuth(), adminHub, listAdminApprovalsHandler);
adminRouter.post(
  "/approvals/:userId/:goalId",
  requireAuth(),
  adminHub,
  decideAdminApprovalHandler,
);
