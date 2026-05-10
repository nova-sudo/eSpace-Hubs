/**
 * Route guard: requires an authenticated session. 401 otherwise.
 *
 * Optionally enforces TOTP — when `requireTotp: true`, a session that
 * hasn't passed the second factor (M2.3c) is rejected with 401 +
 * `code: "totp_required"`. Routes that need a fully-authenticated
 * caller pass `requireTotp: true`; routes that are part of the
 * step-2-of-2 verify flow itself pass `requireTotp: false` so the
 * partial session can still reach them.
 */

import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./error-handler.js";

export interface RequireAuthOptions {
  requireTotp?: boolean;
}

export function requireAuth(options: RequireAuthOptions = {}) {
  const { requireTotp = true } = options;
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.session) {
      return next(new HttpError(401, "unauthenticated", "Login required."));
    }
    if (requireTotp && !req.session.totpVerified) {
      return next(
        new HttpError(
          401,
          "totp_required",
          "Two-factor verification required.",
        ),
      );
    }
    next();
  };
}
