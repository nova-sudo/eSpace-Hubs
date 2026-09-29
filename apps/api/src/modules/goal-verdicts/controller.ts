/**
 * Goal-verdicts controller — the CURRENT user's own manager verdicts.
 *
 *   GET  /api/v1/goal-verdicts/mine                          manager-set tiers on MY goals
 *   GET  /api/v1/goal-verdicts/mine/:goalId/history          every grade on one of MY goals
 *   POST /api/v1/goal-verdicts/mine/:goalId/acknowledge      "Seen" / "I disagree" on it
 *
 * The dev hub hydrates this so a goal's badge can prefer the manager's
 * authoritative tier over the AI cache. Scoped to session.userId as the
 * SUBJECT — you only ever read (or acknowledge) verdicts about yourself.
 */

import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";
import {
  acknowledgeManagerVerdict,
  ackToJson,
  currentVerdictToJson,
  isNewDispute,
  listManagerVerdictHistory,
  listManagerVerdictsForSubject,
  verdictPeriodKey,
} from "../../lib/manager-verdicts.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { notifyVerdictDisputed } from "../../lib/notifications.js";
import { HttpError } from "../../middleware/error-handler.js";

function goalIdParam(req: Request): string {
  const goalId = String(req.params.goalId ?? "");
  if (!goalId || goalId.length > 200) {
    throw new HttpError(404, "not_found", "No manager grade on that goal.");
  }
  return goalId;
}

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
        periodKey: verdictPeriodKey(v),
        eventId: v.eventId ? v.eventId.toHexString() : null,
        ack: ackToJson(v.ack),
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** One of MY goals' grade history, oldest first — read-only. */
export async function getMyVerdictHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const { current, history } = await listManagerVerdictHistory(
      session.orgId,
      session.userId,
      goalIdParam(req),
    );
    res.json({ current: currentVerdictToJson(current), history });
  } catch (err) {
    next(err);
  }
}

/**
 * Acknowledge my CURRENT manager grade on a goal. Body:
 *   { disagree?: boolean, note?: string }   note only kept with disagree
 * 404 when there's no grade to acknowledge. Re-posting replaces the ack
 * (e.g. "seen" → "I disagree"); a new grade from the manager clears it.
 */
export async function acknowledgeMyVerdictHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const goalId = goalIdParam(req);
    const body = (req.body ?? {}) as {
      disagree?: unknown;
      note?: unknown;
      eventId?: unknown;
    };
    if (body.disagree !== undefined && typeof body.disagree !== "boolean") {
      throw new HttpError(400, "invalid_body", "disagree must be true or false.");
    }
    if (body.note !== undefined && typeof body.note !== "string") {
      throw new HttpError(400, "invalid_body", "note must be text.");
    }
    if (
      body.eventId !== undefined &&
      body.eventId !== null &&
      (typeof body.eventId !== "string" || !ObjectId.isValid(body.eventId))
    ) {
      throw new HttpError(400, "invalid_body", "eventId must be a grade id.");
    }
    const disagree = body.disagree === true;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2_000) : "";

    const result = await acknowledgeManagerVerdict({
      orgId: session.orgId,
      subjectUserId: session.userId,
      goalId,
      disagree,
      note,
      eventId: typeof body.eventId === "string" ? new ObjectId(body.eventId) : null,
    });
    if (!result) {
      throw new HttpError(404, "not_found", "No manager grade on that goal.");
    }
    if ("stale" in result) {
      throw new HttpError(
        409,
        "verdict_changed",
        "Your manager just updated this grade — reload to see the new one.",
      );
    }

    // A disagreement on a grade of record is part of the review trail.
    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "goal_verdict.acknowledge",
      targetType: "goal",
      targetId: goalId,
      after: {
        tier: result.verdict.tier,
        periodKey: verdictPeriodKey(result.verdict),
        disagree,
        hasNote: result.ack.note.length > 0,
      },
      ...networkMeta(req),
    });

    // A dispute must reach the report's CURRENT manager (or the admins),
    // not wait for them to open the board — but only once per dispute:
    // when the ack turns into a disagreement, or its note changes. A
    // double-click or a repost of the same dispute stays silent.
    if (isNewDispute(result.previousAck, result.ack)) {
      void notifyVerdictDisputed({
        orgId: session.orgId,
        subjectUserId: session.userId,
        gradedBy: result.verdict.gradedBy,
        goalId,
        tier: result.verdict.tier,
        note: result.ack.note,
      });
    }

    res.json({ ok: true, verdict: currentVerdictToJson(result.verdict) });
  } catch (err) {
    next(err);
  }
}
