/**
 * /api/v1/hubs/me — returns the hubs the current user can access.
 *
 * Reads the user's `allowedHubs` + `primaryHub` from the session-
 * referenced user doc, resolves them against the shared registry,
 * and returns:
 *
 *   {
 *     hubs: HubDefinition[],     // ordered by HUB_ORDER
 *     primaryHubId: string,      // member of hubs[*].id
 *     defaultHubId: string,      // the registry's overall default
 *   }
 *
 * Pre-M10 users have neither field on their doc; we apply the
 * DEFAULT_HUB_ID fallback so the response stays useful while we
 * roll out the schema (no migration required).
 *
 * Public per-hub metadata (theme, allowedIntegrations, page slots,
 * widget catalog) ships in the response so the frontend can render
 * the chrome without a separate registry fetch.
 */

import type { NextFunction, Request, Response } from "express";
import {
  DEFAULT_HUB_ID,
  HUBS,
  findHubById,
  resolveAllowedHubs,
} from "@espace-devhub/shared/hubs";
import { getUsersCollection } from "../../db/collections.js";
import { HttpError } from "../../middleware/error-handler.js";

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
      // Session referenced a deleted user — let the existing auth
      // path surface this as an unauthenticated state.
      throw new HttpError(401, "unauthenticated", "User no longer exists.");
    }

    // Resolve allowed hubs through the registry. Unknown ids on the
    // user doc are silently filtered out so a hub removed from the
    // registry doesn't leave the user staring at a broken switcher.
    const allowedIds =
      Array.isArray(user.allowedHubs) && user.allowedHubs.length > 0
        ? user.allowedHubs
        : [DEFAULT_HUB_ID];
    let hubs = resolveAllowedHubs(allowedIds);
    if (hubs.length === 0) {
      // Defense in depth: if the user's allowedHubs all reference
      // unknown ids, fall back to the default rather than returning
      // an empty list (which would lock the user out of every hub).
      const fallback = findHubById(DEFAULT_HUB_ID);
      hubs = fallback ? [fallback] : Object.values(HUBS);
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
