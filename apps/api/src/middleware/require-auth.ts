/**
 * Route guard: requires an authenticated session. 401 otherwise.
 *
 * Two orthogonal gates on top of "session exists":
 *
 *   1. requireTotp (default true) — the session must have cleared its
 *      second-factor step for this login. Set false only on the very
 *      narrow set of routes that participate in step-2 of the login
 *      flow itself (POST /auth/totp/verify), where the session
 *      legitimately carries totpVerified=false until the route flips
 *      it.
 *
 *   2. requireTotpEnrolled (default true) — the user must have
 *      enrolment on file at all. Closes the security hole where a
 *      fresh user (no TOTP secret yet) was being minted with
 *      totpVerified=true at login (because there was nothing to
 *      verify) and could then call any protected route while still
 *      un-enrolled. Carve-outs:
 *        - /auth/me — frontend reads this WHILE on /totp-setup
 *        - /auth/totp/enrol — starts the enrolment
 *        - /auth/totp/verify-enrolment — completes it
 *        - /auth/logout — always allowed
 *
 * The flag is pinned to the session at mint time and toggled by
 * /verify-enrolment / /disable, so the check is in-memory on the
 * session doc — no per-request DB lookup. Sessions minted before
 * this field existed have `totpEnrolled === undefined`; we treat
 * those as "enrolled" (lenient) because every existing user as of
 * this commit's deploy IS enrolled. The startup migration backfills
 * the flag on those rows so they don't stay undefined.
 */

import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./error-handler.js";

export interface RequireAuthOptions {
  requireTotp?: boolean;
  requireTotpEnrolled?: boolean;
}

export function requireAuth(options: RequireAuthOptions = {}) {
  const { requireTotp = true, requireTotpEnrolled = true } = options;
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
    if (
      requireTotpEnrolled &&
      // `undefined` from legacy sessions falls through as "enrolled"
      // for safety — every current user is enrolled; the migration
      // backfills the field. `false` explicitly blocks.
      req.session.totpEnrolled === false
    ) {
      return next(
        new HttpError(
          401,
          "totp_enrolment_required",
          "Two-factor enrolment required. Set it up before continuing.",
        ),
      );
    }
    next();
  };
}
