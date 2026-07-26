/**
 * Route guard: requires an authenticated session holding at least one of
 * the allowed roles. 403 if authenticated but no allowed role is held.
 *
 * Always pair with `requireAuth` — this guard does NOT check session
 * presence (so the 401 vs 403 distinction stays correct: 401 = "log
 * in", 403 = "you're logged in but not allowed").
 *
 * Checks `req.session.roles` — the FULL effective-roles snapshot taken
 * at login (mint time), not just the single "primary" `req.session.role`.
 * This deliberately does NOT reduce to one role and compare: a user can
 * legitimately hold several roles (["dev", "admin"]), and which one a
 * caller happened to write first into the `roles` array on the user doc
 * is an implementation detail of whatever UI/script made the edit — it
 * is NOT a meaningful signal for authorization. Checking membership
 * across the whole set is the only version of this check that can't be
 * broken by array-ordering.
 *
 * (`req.session.roles` is itself a snapshot with no per-request DB
 * lookup — same performance tradeoff as the TOTP flags in requireAuth.
 * Falls back to `[req.session.role]` for sessions minted before this
 * field existed. That tradeoff is only safe if every write path that
 * changes the underlying roles also re-syncs it into live sessions. See
 * `syncSessionRolesForUser` in `../modules/auth/session.js`, called from
 * the admin user-update handler — without that call, a role promotion
 * granted mid-session is invisible to this guard until the user logs
 * out and back in.
 *
 * History: an earlier version of this fix synced only the singular
 * `session.role`, computed as `roles[0]`. That still broke, because
 * `roles[0]` isn't reliably "the role that matters" — granting a second
 * role via the admin UI appends it to the END of the array, so a
 * freshly-admin-granted user kept minting sessions with role "dev"
 * (their original role) and 403-ing every admin route no matter how
 * many times they logged out and back in. Checking the full set here
 * closes that entire bug class regardless of array order.
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
    const heldRoles =
      req.session.roles && req.session.roles.length > 0
        ? req.session.roles
        : [req.session.role];
    if (!allowed.some((r) => heldRoles.includes(r))) {
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
