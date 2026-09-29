/**
 * /api/v1/manager/* router.
 *
 *   GET    /reports                                     direct reports
 *   GET    /team-summary                                every report's rollup
 *   GET    /reports/:userId/goal-health                 one report's board
 *   GET    /reports/:userId/goals/:goalId/detail        one goal, read-only
 *   GET    /reports/:userId/goals/:goalId/verdicts      grade history + ack
 *   PUT    /reports/:userId/goals/:goalId/verdict       grade (append-only)
 *   POST   /reports/:userId/goals/:goalId/approval      approve / request changes
 *   GET    /reports/:userId/review-packets              submitted evidence docs
 *   GET    /reports/:userId/snapshots                   weekly headline series
 *   GET    /reports/:userId/notes                       my 1:1 notes on them
 *   POST   /reports/:userId/notes                       add a note
 *   PATCH  /reports/:userId/notes/:noteId               edit a note
 *   DELETE /reports/:userId/notes/:noteId               delete a note
 *   GET    /grading-progress                            graded N of M, per report
 *   GET    /team-trends                                 every report's series
 *   GET    /delegated-queue · /approvals                work queues
 *   GET    /tier-policies · /goal-codes                 org-wide criteria
 *   PUT    /tier-policies/:code                         set criteria
 *   DELETE /tier-policies/:code                         clear criteria
 *
 * Authorization: a full session (`requireAuth`) plus the
 * `manager.team.view` capability (`requireCapability`). Every per-report
 * route additionally goes through resolveReport (./resolve-report.ts):
 * managerId === session.userId inside the session's org, else 404 — so
 * holding the capability without being someone's manager returns
 * nothing. Every mutation writes an audit row (`manager.*`).
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
  listGoalVerdictHistoryHandler,
  listTierPoliciesHandler,
  putApprovalDecisionHandler,
  putGoalVerdictHandler,
  putTierPolicyHandler,
} from "./controller.js";
import {
  createReportNoteHandler,
  deleteReportNoteHandler,
  getGradingProgressHandler,
  getReportSnapshotsHandler,
  getTeamTrendsHandler,
  listReportNotesHandler,
  updateReportNoteHandler,
} from "./surfaces-controller.js";

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

managerRouter.get(
  "/reports/:userId/goals/:goalId/verdicts",
  requireAuth(),
  requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW),
  listGoalVerdictHistoryHandler,
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

// §1.5 surfaces (./report-surfaces.ts). Team-level reads are scoped to
// the caller's active reports; per-report reads go through resolveReport.
const gate = [requireAuth(), requireCapability(CAPABILITIES.MANAGER_TEAM_VIEW)];

managerRouter.get("/grading-progress", ...gate, getGradingProgressHandler);
managerRouter.get("/team-trends", ...gate, getTeamTrendsHandler);
managerRouter.get("/reports/:userId/snapshots", ...gate, getReportSnapshotsHandler);
managerRouter.get("/reports/:userId/notes", ...gate, listReportNotesHandler);
managerRouter.post("/reports/:userId/notes", ...gate, createReportNoteHandler);
managerRouter.patch("/reports/:userId/notes/:noteId", ...gate, updateReportNoteHandler);
managerRouter.delete("/reports/:userId/notes/:noteId", ...gate, deleteReportNoteHandler);
