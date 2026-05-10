/**
 * /api/v1/integrations/* router.
 *
 *   GET     /                    authed — list public shape (no tokens)
 *   GET     /:providerId          authed — single resource (404 if not connected)
 *   POST    /                    authed — upsert (encrypts tokens server-side)
 *   DELETE  /:providerId          authed — disconnect
 *
 * No public path returns ciphertext or plaintext tokens. Decrypted
 * tokens are loaded internally by the proxy module via
 * `loadDecryptedTokens` from controller.ts (called only inside the
 * API process, never exposed via a route).
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  disconnectIntegrationHandler,
  getIntegrationHandler,
  listIntegrationsHandler,
  upsertIntegrationHandler,
} from "./controller.js";

export const integrationsRouter: Router = Router();

integrationsRouter.get("/", requireAuth(), listIntegrationsHandler);
integrationsRouter.post("/", requireAuth(), upsertIntegrationHandler);
integrationsRouter.get("/:providerId", requireAuth(), getIntegrationHandler);
integrationsRouter.delete(
  "/:providerId",
  requireAuth(),
  disconnectIntegrationHandler,
);
