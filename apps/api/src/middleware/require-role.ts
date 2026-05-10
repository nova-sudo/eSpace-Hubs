/**
 * Route guard: requires an authenticated session with a role in the
 * allowed set. 403 if authenticated but role doesn't match.
 *
 * Always pair with `requireAuth` — this guard does NOT check session
 * presence (so the 401 vs 403 distinction stays correct: 401 = "log
 * in", 403 = "you're logged in but not allowed").
 */

import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../db/types.js";
import { HttpError } from "./error-handler.js";

export function requireRole(...allowed: UserRole[]) {
  if (allowed.length === 0) {
    throw new Error("requireRole: at least one role must be specified");
  }
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.session) {
      // Defensive — `requireAuth` should run first. Treat as auth failure
      // to keep the contract simple.
      return next(new HttpError(401, "unauthenticated", "Login required."));
    }
    if (!allowed.includes(req.session.role)) {
      return next(
        new HttpError(
          403,
          "forbidden",
          `Requires role: ${allowed.join(", ")}.`,
        ),
      );
    }
    next();
  };
}
