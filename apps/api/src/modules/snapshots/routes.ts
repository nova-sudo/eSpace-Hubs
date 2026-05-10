/**
 * /api/v1/snapshots/* router.
 *
 *   GET     /              authed — list, optional ?since, ?until, ?limit
 *   POST    /              authed — upsert (manual-wins-over-auto)
 *   PATCH   /:week          authed — partial update (typically `note`)
 *   DELETE  /:week          authed — remove
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  deleteSnapshotHandler,
  listSnapshotsHandler,
  patchSnapshotHandler,
  upsertSnapshotHandler,
} from "./controller.js";

export const snapshotsRouter: Router = Router();

snapshotsRouter.get("/", requireAuth(), listSnapshotsHandler);
snapshotsRouter.post("/", requireAuth(), upsertSnapshotHandler);
snapshotsRouter.patch("/:week", requireAuth(), patchSnapshotHandler);
snapshotsRouter.delete("/:week", requireAuth(), deleteSnapshotHandler);
