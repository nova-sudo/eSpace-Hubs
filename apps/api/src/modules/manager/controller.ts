/**
 * Manager controller — a manager's read surface over their direct
 * reports. Every query is scoped to `managerId === session.userId`
 * inside the session's org, so a manager only ever sees the people who
 * report to them (never the whole org — that's admin's job).
 *
 *   GET /api/v1/manager/reports   list the manager's direct reports
 *
 * Gated by `requireCapability(manager.team.view)` in routes.ts; the
 * controller assumes that passed and applies the managerId + orgId
 * boundary. Per-report goal-health rolls up in P1 — see
 * docs/manager-hub-plan.md.
 */

import type { NextFunction, Request, Response } from "express";
import { getUsersCollection } from "../../db/collections.js";
import type { User, UserRole } from "../../db/types.js";
import { primaryRole } from "../../lib/user-roles.js";
import { HttpError } from "../../middleware/error-handler.js";

/**
 * What a manager sees per direct report. Deliberately thin — identity +
 * org-chart context only. No secrets, no performance data yet (that
 * lands with the P1 goal-health endpoint).
 */
interface ReportCard {
  id: string;
  displayName: string;
  email: string;
  role: UserRole;
  department: string | null;
  level: string | null;
}

function toReportCard(u: User): ReportCard {
  return {
    id: u._id.toHexString(),
    displayName: u.displayName,
    email: u.email,
    role: primaryRole(u),
    department: u.department ?? null,
    level: u.level ?? null,
  };
}

export async function listReportsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }

    const users = await getUsersCollection();
    const docs = await users
      .find({
        orgId: session.orgId,
        managerId: session.userId,
        status: { $ne: "disabled" },
      })
      .sort({ displayName: 1 })
      .toArray();

    res.json({ reports: docs.map(toReportCard) });
  } catch (err) {
    next(err);
  }
}
