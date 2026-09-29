/**
 * /api/v1/hubs/me — returns the hubs the current user can access.
 *
 * Resolution layers (in order):
 *   1. Shared registry defaults     — @espace-devhub/shared/hubs
 *   2. Capability gate              — user's roles → capabilities →
 *                                       intersect with each hub's
 *                                       `requires` list (M-CAP)
 *   3. Per-(orgId, hubId) overrides — hub_configs collection (M10.5)
 *
 * Response:
 *   { hubs: HubDefinition[], primaryHubId: string | null, defaultHubId: string }
 *   (primaryHubId is null when the user may enter no hub at all)
 *
 * Pre-M-CAP users (only `role` set, no `roles`) get a compat fallback
 * via `effectiveRoles(u)` — single-role behaviour is preserved until
 * the boot-time migration writes `roles` for every row.
 *
 * Per-hub metadata (theme, allowedIntegrations, page slots, widget
 * catalog) ships in the response so the frontend renders the chrome
 * without a separate registry fetch, and admin overrides take effect
 * on the very next /hubs/me round-trip.
 */

import type { NextFunction, Request, Response } from "express";
import {
  DEFAULT_HUB_ID,
  resolveHubsForCapabilities,
} from "@espace-devhub/shared/hubs";
import {
  getHubConfigsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type { HubConfig } from "../../db/types.js";
import { effectiveCapabilities } from "../../lib/user-roles.js";
import { HttpError } from "../../middleware/error-handler.js";
import { logger } from "../../lib/logger.js";
import { resolveVisibleHubs } from "./merge.js";

export async function listMyHubsHandler(
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
    const user = await users.findOne(
      { _id: session.userId },
      { projection: { role: 1, roles: 1, primaryHub: 1 } },
    );
    if (!user) {
      throw new HttpError(401, "unauthenticated", "User no longer exists.");
    }

    // Load the org's overrides once, keyed by hubId for O(1) merge.
    const hubConfigs = await getHubConfigsCollection();
    const overrideRows = await hubConfigs
      .find({ orgId: session.orgId })
      .toArray();
    const overrideByHubId = new Map<string, HubConfig>(
      overrideRows.map((row) => [row.hubId, row] as const),
    );

    // M-CAP: resolve the user's capabilities from their roles. Pre-
    // migration users get `[u.role]` as the fallback role set.
    const userCaps = effectiveCapabilities({
      role: user.role,
      roles: user.roles ?? null,
    });

    // Capability filter first (authoritative gate), then per-hub
    // override merge. Hub ids stay in HUB_ORDER. If overrides hid every
    // allowed hub, `resolveVisibleHubs` falls back to the capability-
    // allowed set with overrides ignored — never to hubs the user's roles
    // don't reach (hub-audit §3.2).
    const { hubs, fallback } = resolveVisibleHubs(
      resolveHubsForCapabilities(userCaps),
      overrideByHubId,
    );
    if (fallback) {
      logger.warn(
        { orgId: session.orgId.toHexString(), userId: session.userId.toHexString() },
        "[hubs] every hub this user may enter is disabled by an org override — serving registry defaults",
      );
    }

    // No hub at all → no primary hub either. Naming DEFAULT_HUB_ID here
    // would point the client at a hub this user can't enter.
    const primaryHubId =
      (typeof user.primaryHub === "string" &&
        hubs.some((h) => h.id === user.primaryHub) &&
        user.primaryHub) ||
      hubs[0]?.id ||
      null;

    res.json({
      hubs,
      primaryHubId,
      defaultHubId: DEFAULT_HUB_ID,
    });
  } catch (err) {
    next(err);
  }
}
