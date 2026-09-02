/**
 * /api/v1/manager/* router.
 *
 *   GET /reports              list the authenticated manager's direct reports
 *   GET /tier-policies        list org-wide manager tier-criteria policies
 *   PUT /tier-policies/:code  set a Goal Code's final/cadence tier criteria
 *   DELETE /tier-policies/:code   clear a Goal Code's policy
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
  deleteTierPolicyHandler,
  getReportGoalDetailHandler,
  getReportGoalHealthHandler,
  getTeamSummaryHandler,
  listApprovalsHandler,
  listDelegatedQueueHandler,
  listReportReviewPacketsHandler,
  listReportsHandler,
  listGoalCodesHandler,
  listTierPoliciesHandler,
  putApprovalDecisionHandler,
  putGoalVerdictHandler,
  putTierPolicyHandler,
} from "./controller.js";

export const managerRouter: Router = Router();

managerRouter.get(
  "/reports",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  listReportsHandler,
);

// Team rollup in one request — replaces the browser's per-report fan-out.
managerRouter.get(
  "/team-summary",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  getTeamSummaryHandler,
);

managerRouter.get(
  "/reports/:userId/goal-health",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  getReportGoalHealthHandler,
);

managerRouter.get(
  "/reports/:userId/goals/:goalId/detail",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  getReportGoalDetailHandler,
);

managerRouter.get(
  "/reports/:userId/review-packets",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  listReportReviewPacketsHandler,
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

// Tier policies — manager-authored achievement-tier CRITERIA by Goal Code.
// Org-wide (not scoped to this manager's own reports), so these deliberately
// don't go through resolveReport()/:userId like the routes above.
managerRouter.get(
  "/tier-policies",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  listTierPoliciesHandler,
);

// F6 — the codes that exist in the org, with goal/people counts. Powers
// the policy authoring picker + "affects N goals across M people".
managerRouter.get(
  "/goal-codes",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  listGoalCodesHandler,
);

managerRouter.put(
  "/tier-policies/:code",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  putTierPolicyHandler,
);

managerRouter.delete(
  "/tier-policies/:code",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  deleteTierPolicyHandler,
);
