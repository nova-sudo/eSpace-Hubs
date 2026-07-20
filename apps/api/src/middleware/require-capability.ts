/**
 * Route guard: requires an authenticated session whose user holds ALL of
 * the given capabilities. 403 otherwise.
 *
 * Always pair with `requireAuth` (which establishes the session and 401s
 * when it's absent) — this guard only checks authorisation, so the
 * 401-vs-403 split stays correct.
 *
 * Resolution: capabilities are computed from the user's FULL role set
 * (`effectiveCapabilities`), read fresh from the users collection by
 * `session.userId`. Deliberately NOT from `session.role` (the single
 * primary-role snapshot `requireRole` reads):
 *
 *   - Multi-role correctness: a user who is `admin` AND `manager` has
 *     `admin` as their primary role, so a primary-role check would deny
 *     them `manager.team.view` even though they hold the manager role.
 *   - Freshness: reading the current user doc means a role change takes
 *     effect on the next request — no re-login to re-mint the session.
 *
 * Cost: one indexed user lookup per guarded request. Manager routes hit
 * the DB anyway, so this is negligible.
 */

import type { NextFunction, Request, Response } from "express";
import { type Capability } from "@espace-devhub/shared/capabilities";
import { getUsersCollection } from "../db/collections.js";
import { effectiveCapabilities } from "../lib/user-roles.js";
import { HttpError } from "./error-handler.js";

export function requireCapability(...required: Capability[]) {
  if (required.length === 0) {
    throw new Error(
      "requireCapability: at least one capability must be specified",
    );
  }
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.session) {
        // Defensive — `requireAuth` should run first.
        return next(new HttpError(401, "unauthenticated", "Login required."));
      }
      const users = await getUsersCollection();
      const user = await users.findOne({
        _id: req.session.userId,
        orgId: req.session.orgId,
      });
      if (!user) {
        return next(new HttpError(401, "unauthenticated", "Login required."));
      }
      const held = effectiveCapabilities(user);
      const missing = required.filter((cap) => !held.has(cap));
      if (missing.length > 0) {
        return next(
          new HttpError(
            403,
            "forbidden",
            `Requires capability: ${required.join(", ")}.`,
          ),
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
