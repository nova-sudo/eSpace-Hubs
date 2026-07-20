/**
 * /api/v1/manager/* router.
 *
 *   GET /reports   list the authenticated manager's direct reports
 *
 * Authorization: a full session (`requireAuth`) plus the
 * `manager.team.view` capability (`requireCapability`). The controller
 * additionally scopes every read to `managerId === session.userId`, so
 * holding the capability without actually being someone's manager just
 * returns an empty list.
 *
 * This is the foundation module for the Manager hub; grading, delegated
 * verdicts, approvals, and notifications land in later drops
 * (docs/manager-hub-plan.md).
 */

import { Router } from "express";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import {
  getReportGoalHealthHandler,
  listApprovalsHandler,
  listDelegatedQueueHandler,
  listReportsHandler,
  putApprovalDecisionHandler,
  putGoalVerdictHandler,
} from "./controller.js";

export const managerRouter: Router = Router();

managerRouter.get(
  "/reports",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  listReportsHandler,
);

managerRouter.get(
  "/reports/:userId/goal-health",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  getReportGoalHealthHandler,
);

managerRouter.get(
  "/delegated-queue",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  listDelegatedQueueHandler,
);

managerRouter.get(
  "/approvals",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  listApprovalsHandler,
);

managerRouter.post(
  "/reports/:userId/goals/:goalId/approval",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  putApprovalDecisionHandler,
);

managerRouter.put(
  "/reports/:userId/goals/:goalId/verdict",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  putGoalVerdictHandler,
);
