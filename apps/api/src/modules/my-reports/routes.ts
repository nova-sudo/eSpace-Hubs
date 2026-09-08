/**
 * /api/v1/my-reports/* router.
 *
 *   GET  /            the authenticated user's direct reports (may be empty)
 *   POST /resolve     which of these email addresses are already my reports
 *   GET  /fills       what each report has logged, for the plan's roster view
 *
 * Authorization is `requireAuth()` plus the controller's `managerId ===
 * session.userId` scoping, and nothing else — see the controller header. No
 * capability gate on purpose: a dev-hub team lead is exactly the user this
 * exists for, and they don't hold MANAGER_TEAM_VIEW. Someone who manages
 * nobody gets an empty list rather than a 403, which is the honest answer.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  listMyReportsHandler,
  listReportFillsHandler,
  resolveMyReportsHandler,
} from "./controller.js";

export const myReportsRouter: Router = Router();

myReportsRouter.get("/", requireAuth(), listMyReportsHandler);
myReportsRouter.post("/resolve", requireAuth(), resolveMyReportsHandler);
myReportsRouter.get("/fills", requireAuth(), listReportFillsHandler);
