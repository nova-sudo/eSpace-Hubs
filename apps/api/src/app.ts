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

  // ─── tail handlers ─────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
