/**
 * /api/v1/onboarding — the M-OB submit handler.
 *
 * Receives the user's profile fields, resolves their hub via the
 * shared registry's department mapping, persists everything in one
 * atomic users.findOneAndUpdate, and returns the resolved hub so the
 * frontend can navigate.
 *
 * Idempotency: re-submitting after onboarding is complete is allowed
 * (the user is just updating their profile) — we don't reject on
 * `onboardingCompletedAt` already being set. The handler always
 * recomputes the resolved hub from the new department; an admin
 * override applied since the last submit takes effect on the next
 * /hubs/me round-trip.
 */

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  DEFAULT_HUB_ID,
  getHubIdForDepartment,
} from "@espace-devhub/shared/hubs";
import { getUsersCollection } from "../../db/collections.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { HttpError } from "../../middleware/error-handler.js";
import { toPublicUser } from "../auth/controller.js";

const submitSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  employeeId: z.string().trim().min(1).max(64),
  department: z.string().trim().min(1).max(200),
});

export async function submitOnboardingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }

    const payload = submitSchema.parse(req.body);

    // Resolve department → hub. `getHubIdForDepartment` returns
    // DEFAULT_HUB_ID for unknown departments (rather than null) so
    // the user always lands somewhere coherent — the registry's
    // fallback is the design contract.
    const resolvedHubId =
      getHubIdForDepartment(payload.department) ?? DEFAULT_HUB_ID;

    const now = new Date();
    const users = await getUsersCollection();
    const result = await users.findOneAndUpdate(
      { _id: session.userId },
      {
        $set: {
          displayName: payload.displayName,
          employeeId: payload.employeeId,
          department: payload.department,
          allowedHubs: [resolvedHubId],
          primaryHub: resolvedHubId,
          onboardingCompletedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    if (!result) {
      throw new HttpError(401, "unauthenticated", "User no longer exists.");
    }

    await writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      actorRole: session.role,
      action: "user.onboarding_submit",
      targetType: "user",
      targetId: session.userId.toHexString(),
      after: {
        department: payload.department,
        employeeId: payload.employeeId,
        resolvedHubId,
      },
      ...networkMeta(req),
    });

    res.json({
      user: toPublicUser(result),
      redirectTo: `/${resolvedHubId}`,
    });
  } catch (err) {
    next(err);
  }
}
