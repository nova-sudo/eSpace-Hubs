/**
 * Goal-verdicts controller — the CURRENT user's own manager verdicts.
 *
 *   GET /api/v1/goal-verdicts/mine   manager-set tiers on MY goals
 *
 * The dev hub hydrates this so a goal's badge can prefer the manager's
 * authoritative tier over the AI cache. Scoped to session.userId as the
 * SUBJECT — you only ever read verdicts about yourself here.
 */

import type { NextFunction, Request, Response } from "express";
import { listManagerVerdictsForSubject } from "../../lib/manager-verdicts.js";
import { HttpError } from "../../middleware/error-handler.js";

export async function listMyVerdictsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const rows = await listManagerVerdictsForSubject(
      session.orgId,
      session.userId,
    );
    res.json({
      verdicts: rows.map((v) => ({
        goalId: v.goalId,
        tier: v.tier,
        note: v.note,
        gradedByName: v.gradedByName,
        gradedAt: v.gradedAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
}
