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
 *   { hubs: HubDefinition[], primaryHubId: string, defaultHubId: string }
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
  HUB_ORDER,
  findHubById,
  resolveHubsForCapabilities,
} from "@espace-devhub/shared/hubs";
import {
  getHubConfigsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type { HubConfig } from "../../db/types.js";
import { effectiveCapabilities } from "../../lib/user-roles.js";
import { HttpError } from "../../middleware/error-handler.js";
import { mergeHubOverride } from "./merge.js";

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
    // override merge. Hub ids stay in HUB_ORDER.
    const capAllowedIds = new Set(
      resolveHubsForCapabilities(userCaps).map((h) => h.id),
    );

    const hubs = [];
    for (const hubId of HUB_ORDER) {
      if (!capAllowedIds.has(hubId)) continue;
      const defaults = findHubById(hubId);
      if (!defaults) continue;
      const { hub, enabled } = mergeHubOverride(
        defaults,
        overrideByHubId.get(hubId) ?? null,
      );
      if (!enabled) continue; // admin disabled this hub for the org
      hubs.push(hub);
    }

    if (hubs.length === 0) {
      // Defense in depth: a user whose roles grant nothing, or whose
      // hubs are all admin-disabled, would otherwise see an empty
      // list and get stuck. Falling back to the default hub keeps the
      // app navigable while ops fixes the misconfiguration.
      //
      // Specifically covers the bootstrap-admin window before the
      // M-CAP migration runs: their `role: "admin"` resolves to
      // hub.admin.access via the compat shim, so this branch is
      // mostly a paranoid catch-all.
      const defaults = findHubById(DEFAULT_HUB_ID);
      if (defaults) {
        const merged = mergeHubOverride(
          defaults,
          overrideByHubId.get(DEFAULT_HUB_ID) ?? null,
        );
        if (merged.enabled) hubs.push(merged.hub);
        else {
          // Even the default is disabled — admit every registry hub
          // ignoring overrides. Worst-case correctness.
          for (const fallbackId of HUB_ORDER) {
            const fb = findHubById(fallbackId);
            if (fb) hubs.push(fb);
          }
        }
      }
    }

    const primaryHubId =
      (typeof user.primaryHub === "string" &&
        hubs.some((h) => h.id === user.primaryHub) &&
        user.primaryHub) ||
      hubs[0]?.id ||
      DEFAULT_HUB_ID;

    res.json({
      hubs,
      primaryHubId,
      defaultHubId: DEFAULT_HUB_ID,
    });
  } catch (err) {
    next(err);
  }
}
