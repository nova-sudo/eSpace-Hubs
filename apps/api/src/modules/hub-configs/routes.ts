/**
 * /api/v1/hub-configs/* router.
 *
 *   GET    /                 admin: list every override for the org
 *   GET    /:hubId           admin: one override (or 404)
 *   PUT    /:hubId           admin: upsert
 *   DELETE /:hubId           admin: revert to registry default
 *
 * The list/get reads are admin-only too — overrides aren't sensitive
 * but admin is the audience that needs them, and exposing the routes
 * to non-admin sessions just bloats the public surface.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireRole } from "../../middleware/require-role.js";
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
  requireRole("admin"),
  listHubConfigsHandler,
);
hubConfigsRouter.get(
  "/:hubId",
  requireAuth(),
  requireRole("admin"),
  getHubConfigHandler,
);
hubConfigsRouter.put(
  "/:hubId",
  requireAuth(),
  requireRole("admin"),
  upsertHubConfigHandler,
);
hubConfigsRouter.delete(
  "/:hubId",
  requireAuth(),
  requireRole("admin"),
  deleteHubConfigHandler,
);
