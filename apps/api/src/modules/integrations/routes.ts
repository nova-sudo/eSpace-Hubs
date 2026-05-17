/**
 * /api/v1/integrations/* router.
 *
 *   GET     /                            authed — list public shape (no tokens)
 *   POST    /                            authed — upsert (encrypts tokens)
 *   GET     /:providerId                  authed — single resource
 *   DELETE  /:providerId                  authed — disconnect
 *
 *   ANY     /proxy/github/*                authed — proxy to api.github.com
 *   ANY     /proxy/gitlab/*                authed — proxy to <user's GitLab>/api/v4
 *   ANY     /proxy/jira/*                  authed — proxy to <user's Jira>/rest/api/3
 *   ANY     /proxy/jenkins/*               authed — proxy to <user's Jenkins>/<path>
 *
 * No public path returns ciphertext or plaintext tokens. The proxy
 * module reads tokens via `loadDecryptedTokens` and uses them only
 * for OUTBOUND HTTP — never echoed back to the caller.
 *
 * Proxy route ordering: `/proxy/...` must come BEFORE `/:providerId`,
 * otherwise Express matches "proxy" as a providerId param.
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  disconnectIntegrationHandler,
  getIntegrationHandler,
  listIntegrationsHandler,
  upsertIntegrationHandler,
} from "./controller.js";
import {
  githubProxyHandler,
  gitlabProxyHandler,
  jenkinsProxyHandler,
  jiraProxyHandler,
} from "./proxy.js";

export const integrationsRouter: Router = Router();

// Listing + upsert
integrationsRouter.get("/", requireAuth(), listIntegrationsHandler);
integrationsRouter.post("/", requireAuth(), upsertIntegrationHandler);

// Proxy routes — register BEFORE the /:providerId catch-all below.
// Each one accepts GET + POST (mirroring the legacy Next.js proxy).
for (const method of ["get", "post"] as const) {
  integrationsRouter[method]("/proxy/github/*", requireAuth(), githubProxyHandler);
  integrationsRouter[method]("/proxy/gitlab/*", requireAuth(), gitlabProxyHandler);
  integrationsRouter[method]("/proxy/jira/*", requireAuth(), jiraProxyHandler);
  integrationsRouter[method]("/proxy/jenkins/*", requireAuth(), jenkinsProxyHandler);
}

// Per-provider CRUD — order matters, must come after /proxy/*.
integrationsRouter.get("/:providerId", requireAuth(), getIntegrationHandler);
integrationsRouter.delete(
  "/:providerId",
  requireAuth(),
  disconnectIntegrationHandler,
);
