/**
 * Session resolver. Reads the signed session cookie, looks up the
 * session in Mongo, and (if valid) attaches it to `req.session`.
 *
 * Does NOT gate access — that's `requireAuth`'s job. This middleware
 * runs on every request so handlers can opportunistically read
 * `req.session?.userId` (e.g. for analytics, conditional rendering).
 *
 * Order: must run AFTER cookie-parser (otherwise `req.signedCookies`
 * is empty) and BEFORE any handler that reads `req.session`.
 */

import type { NextFunction, Request, Response } from "express";
import type { Session } from "../db/types.js";
import {
  lookupSession,
  touchSession,
} from "../modules/auth/session.js";
import { SESSION_COOKIE_NAME } from "../modules/auth/cookies.js";
import { logger } from "../lib/logger.js";

declare module "express-serve-static-core" {
  interface Request {
    /**
     * Resolved session row. `undefined` for unauthenticated requests
     * AND for expired cookies (the resolver eagerly clears those).
     * Never trust it for gating — call `requireAuth` instead.
     */
    session?: Session;
  }
}

export async function sessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const sid = req.signedCookies?.[SESSION_COOKIE_NAME];
  if (typeof sid !== "string" || !sid) {
    return next();
  }
  try {
    const session = await lookupSession(sid);
    if (session) {
      req.session = session;
      // Sliding-window touch. Throttled inside `touchSession`, so
      // burst traffic doesn't hammer Mongo.
      void touchSession(session).catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "[session] touch failed",
        );
      });
    }
  } catch (err) {
    // Don't break the request — just leave req.session undefined and
    // let downstream gates 401 if needed.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[session] lookup failed",
    );
  }
  next();
}
