/**
 * /api/v1/hubs/me — returns the hubs the current user can access.
 *
 * Resolution layers (each applied in order):
 *   1. Shared registry defaults     — @espace-devhub/shared/hubs
 *   2. Per-(orgId, hubId) overrides — hub_configs collection (M10.5)
 *   3. User's allowedHubs           — filters which hubs surface
 *
 * Response:
 *   {
 *     hubs: HubDefinition[],     // ordered by HUB_ORDER, post-merge
 *     primaryHubId: string,
 *     defaultHubId: string,
 *   }
 *
 * Pre-M10 users (no allowedHubs / primaryHub on doc) get the
 * DEFAULT_HUB_ID fallback so the response stays useful.
 *
 * Per-hub metadata (theme, allowedIntegrations, page slots, widget
 * catalog) ships in the response so the frontend can render the
 * chrome without a separate registry fetch — and so admin overrides
 * take effect on the very next /hubs/me round-trip.
 */

import type { NextFunction, Request, Response } from "express";
import {
  DEFAULT_HUB_ID,
  HUB_ORDER,
  HUBS,
  findHubById,
} from "@espace-devhub/shared/hubs";
import {
  getHubConfigsCollection,
  getUsersCollection,
} from "../../db/collections.js";
import type { HubConfig } from "../../db/types.js";
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
      { projection: { allowedHubs: 1, primaryHub: 1 } },
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

    // Resolution: every hub in HUB_ORDER → merge defaults + override
    // → filter out disabled ones → intersect with the user's
    // allowedHubs list.
    const userAllowed = new Set<string>(
      Array.isArray(user.allowedHubs) && user.allowedHubs.length > 0
        ? user.allowedHubs
        : [DEFAULT_HUB_ID],
    );

    const hubs = [];
    for (const hubId of HUB_ORDER) {
      const defaults = findHubById(hubId);
      if (!defaults) continue;
      const { hub, enabled } = mergeHubOverride(
        defaults,
        overrideByHubId.get(hubId) ?? null,
      );
      if (!enabled) continue;
      if (!userAllowed.has(hubId)) continue;
      hubs.push(hub);
    }

    if (hubs.length === 0) {
      // Defense in depth: if every hub the user has access to is
      // either unknown or disabled by an admin override, fall back to
      // the default rather than returning an empty list (which would
      // lock the user out of every hub). The fallback is the
      // post-merge version of DEFAULT_HUB_ID — admin overrides still
      // apply.
      const defaults = findHubById(DEFAULT_HUB_ID);
      if (defaults) {
        const merged = mergeHubOverride(
          defaults,
          overrideByHubId.get(DEFAULT_HUB_ID) ?? null,
        );
        if (merged.enabled) {
          hubs.push(merged.hub);
        } else {
          // Even the default is disabled. Last-ditch: every registry
          // hub, ignoring overrides. Prevents a misconfigured admin
          // from locking themselves out.
          for (const fallbackId of HUB_ORDER) {
            const fb = findHubById(fallbackId);
            if (fb) hubs.push(fb);
          }
        }
      } else {
        for (const h of Object.values(HUBS)) hubs.push(h);
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
