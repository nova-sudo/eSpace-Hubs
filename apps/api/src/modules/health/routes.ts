/**
 * Liveness + readiness probes.
 *
 *   GET /healthz   — process is up. Returns 200 unconditionally (used by
 *                    k8s liveness probe / Render health check).
 *
 *   GET /readyz    — process is up AND can serve traffic. Verifies Mongo
 *                    is reachable. Returns 503 with state info if not.
 *
 * Deliberately mounted OUTSIDE /api/v1 because health is infrastructure,
 * not an API contract. Versioning these paths would make rolling probes
 * across versions a chore.
 */

import { Router } from "express";
import { dbStatus, pingDb } from "../../db/client.js";

export const healthRouter: Router = Router();

healthRouter.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    service: "espace-devhub-api",
    uptimeSec: Math.round(process.uptime()),
  });
});

healthRouter.get("/readyz", async (_req, res) => {
  const mongoOk = await pingDb();
  const status = dbStatus();
  const ok = mongoOk;

  res.status(ok ? 200 : 503).json({
    status: ok ? "ready" : "not_ready",
    checks: {
      mongo: {
        ok: mongoOk,
        state: status.state,
        ...(status.error ? { error: status.error } : {}),
      },
    },
    uptimeSec: Math.round(process.uptime()),
  });
});
