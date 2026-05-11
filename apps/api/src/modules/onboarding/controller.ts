/**
 * /api/v1/onboarding — the M-OB submit handler.
 *
 * Captures profile fields. Post-M-CAP, hub access is driven by ROLES
 * (assigned by the admin at /invite or by the bootstrap CLI), not by
 * department. This handler therefore does NOT touch the user's
 * `roles` or `primaryHub` — those are the admin's authoritative
 * decision and onboarding shouldn't second-guess them.
 *
 * The `department` field is still captured as a profile attribute
 * (useful for org charts + Zoho reconciliation in M9), but the
 * resolved-hub redirect comes from the user's existing roles via
 * the capability resolver.
 *
 * Redirect logic:
 *   - 1 hub allowed  → redirect to /<hubId>
 *   - 0 hubs allowed → redirect to / (caller surfaces an error or
 *                       falls back to defaults — shouldn't happen
 *                       for a properly invited user)
 *   - >1 hubs        → redirect to / (the post-login picker shows;
 *                       lands in PR 3)
 *
 * Idempotency: re-submission updates profile fields. Existing
 * onboarded users can hit this endpoint again to edit their
 * employeeId / department / displayName.
 */

import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { resolveHubsForCapabilities } from "@espace-devhub/shared/hubs";
import { getUsersCollection } from "../../db/collections.js";
import { networkMeta, writeAudit } from "../../lib/audit.js";
import { effectiveCapabilities } from "../../lib/user-roles.js";
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

    const now = new Date();
    const users = await getUsersCollection();
    const result = await users.findOneAndUpdate(
      { _id: session.userId },
      {
        $set: {
          displayName: payload.displayName,
          employeeId: payload.employeeId,
          department: payload.department,
          onboardingCompletedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    if (!result) {
      throw new HttpError(401, "unauthenticated", "User no longer exists.");
    }

    // Compute the redirect from the user's CURRENT roles (set by the
    // admin at invite time, not by this handler). One hub → land
    // there. >1 → root, where the post-login picker will render.
    const caps = effectiveCapabilities({
      role: result.role,
      roles: result.roles ?? null,
    });
    const accessibleHubs = resolveHubsForCapabilities(caps);
    const redirectTo =
      accessibleHubs.length === 1
        ? `/${accessibleHubs[0].id}`
        : "/";

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
        hubsAccessible: accessibleHubs.map((h) => h.id),
      },
      ...networkMeta(req),
    });

    res.json({
      user: toPublicUser(result),
      redirectTo,
    });
  } catch (err) {
    next(err);
  }
}
