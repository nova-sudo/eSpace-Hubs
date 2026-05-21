/**
 * Express app builder. Returns a configured Application — does NOT call
 * `.listen()`. Keeping the build pure makes it trivial to mount the same
 * app inside a test runner with supertest in M-later milestones.
 *
 * Middleware order matters here:
 *
 *   1. requestId        — every subsequent log line gets reqId
 *   2. helmet           — security headers as early as possible
 *   3. cors             — preflight before anything else parses bodies
 *   4. cookie-parser    — required by session middleware (M2.3+)
 *   5. body parsers     — JSON only (no multipart by default)
 *   6. pino-http        — request logging with reqId already attached
 *   7. routes
 *   8. notFoundHandler  — synthesises a 404 for unmatched paths
 *   9. errorHandler     — final 4-arg handler shapes errors as JSON
 */

import express, { type Application, type RequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";

import { env, isDev } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { requestId } from "./middleware/request-id.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { sessionMiddleware } from "./middleware/session.js";
import { healthRouter } from "./modules/health/routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { aiRouter } from "./modules/ai/routes.js";
import { goalsRouter } from "./modules/goals/routes.js";
import { goalSpecsRouter } from "./modules/goal-specs/routes.js";
import { goalContextRouter } from "./modules/goal-context/routes.js";
import { goalInputsRouter } from "./modules/goal-inputs/routes.js";
import { snapshotsRouter } from "./modules/snapshots/routes.js";
import { gradingVerdictsRouter } from "./modules/grading-verdicts/routes.js";
import { integrationsRouter } from "./modules/integrations/routes.js";
import { migrateRouter } from "./modules/migrate/routes.js";
import { hubsRouter } from "./modules/hubs/routes.js";
import { hubConfigsRouter } from "./modules/hub-configs/routes.js";
import { onboardingRouter } from "./modules/onboarding/routes.js";
import { adminRouter } from "./modules/admin/routes.js";
import { companionRouter } from "./modules/companion/routes.js";

/**
 * Cast a connect-style middleware to Express's RequestHandler. helmet,
 * cookie-parser, body-parser, and pino-http all declare their middleware
 * with Node's bare `IncomingMessage` / `ServerResponse` types (or
 * `connect.NextHandleFunction`), which Express 4's tightened `app.use`
 * overload no longer accepts directly. Functionally identical at
 * runtime — this just realigns the types.
 */
const mw = (m: unknown): RequestHandler => m as RequestHandler;

export function buildApp(): Application {
  const app = express();

  // Trust the first proxy in dev so X-Forwarded-* is honoured when the
  // Next.js rewrite proxies /api/v1/* on :3000 → :4000. Keep at 1 in
  // prod and adjust per deploy topology.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(requestId);

  app.use(
    mw(
      helmet({
        // Cross-Origin Resource Policy gets in the way of the dev-mode
        // proxy. Helmet's defaults are fine for a JSON API otherwise.
        crossOriginResourcePolicy: { policy: "cross-origin" },
      }),
    ),
  );

  app.use(
    cors({
      origin: (origin, cb) => {
        // Same-origin (no Origin header) is always allowed.
        if (!origin) return cb(null, true);
        if (env.CORS_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.use(mw(cookieParser(env.SESSION_SECRET)));

  app.use(mw(express.json({ limit: "1mb" })));
  app.use(mw(express.urlencoded({ extended: false, limit: "1mb" })));

  app.use(
    mw(
      pinoHttp({
        logger,
        genReqId: (req) => (req as { id?: string }).id ?? "unknown",
        // Don't log healthz at info level — it's noisy under k8s probes.
        customLogLevel: (req, res, err) => {
          if (err) return "error";
          if (req.url?.startsWith("/healthz")) return "trace";
          if (res.statusCode >= 500) return "error";
          if (res.statusCode >= 400) return "warn";
          return isDev ? "debug" : "info";
        },
      }),
    ),
  );

  // Resolve session from the signed cookie BEFORE any route runs, so
  // controllers can read `req.session` without each one repeating the
  // lookup. Doesn't gate access — that's `requireAuth`'s job.
  app.use((req, res, next) => {
    sessionMiddleware(req, res, next).catch(next);
  });

  // ─── routes ────────────────────────────────────────────────────────
  // Health is unversioned — it's infra, not API contract.
  app.use(healthRouter);

  // /api/v1/* — versioned API surface.
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/ai", aiRouter);
  app.use("/api/v1/goals", goalsRouter);
  app.use("/api/v1/goal-specs", goalSpecsRouter);
  app.use("/api/v1/goal-context", goalContextRouter);
  app.use("/api/v1/goal-inputs", goalInputsRouter);
  app.use("/api/v1/snapshots", snapshotsRouter);
  app.use("/api/v1/grading-verdicts", gradingVerdictsRouter);
  app.use("/api/v1/integrations", integrationsRouter);
  app.use("/api/v1/migrate", migrateRouter);
  app.use("/api/v1/hubs", hubsRouter);
  app.use("/api/v1/hub-configs", hubConfigsRouter);
  app.use("/api/v1/onboarding", onboardingRouter);
  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1/companion", companionRouter);

  // ─── tail handlers ─────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
