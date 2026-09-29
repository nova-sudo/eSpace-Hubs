/**
 * /api/v1/hub-configs/* router.
 *
 *   GET    /                 list every override for the org
 *   GET    /:hubId           one override (or 404)
 *   PUT    /:hubId           upsert
 *   DELETE /:hubId           revert to registry default
 *
 * Every route needs `admin.hubs.configure` (hub-audit §2.1), checked
 * server-side by `requireCapability` against the user's CURRENT roles.
 * The reads are gated too — overrides aren't sensitive, but the
 * configure capability is the audience that needs them, and exposing
 * the routes to everyone else just bloats the public surface.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { CAPABILITIES } from "@espace-devhub/shared/capabilities";
import { requireCapability } from "../../middleware/require-capability.js";
import {
  deleteHubConfigHandler,
  getHubConfigHandler,
  listHubConfigsHandler,
  upsertHubConfigHandler,
} from "./controller.js";

export const hubConfigsRouter: Router = Router();

hubConfigsRouter.get(
  "/",
  requireAuth(),
  requireCapability(CAPABILITIES.ADMIN_HUBS_CONFIGURE),
  listHubConfigsHandler,
);
hubConfigsRouter.get(
  "/:hubId",
  requireAuth(),
  requireCapability(CAPABILITIES.ADMIN_HUBS_CONFIGURE),
  getHubConfigHandler,
);
hubConfigsRouter.put(
  "/:hubId",
  requireAuth(),
  requireCapability(CAPABILITIES.ADMIN_HUBS_CONFIGURE),
  upsertHubConfigHandler,
);
hubConfigsRouter.delete(
  "/:hubId",
  requireAuth(),
  requireCapability(CAPABILITIES.ADMIN_HUBS_CONFIGURE),
  deleteHubConfigHandler,
);
