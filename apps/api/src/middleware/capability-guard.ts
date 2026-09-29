/**
 * The DB-free core of the authorization guards (`requireCapability`,
 * `requireAnyCapability`, `requireRole`). Each guard re-reads the user on
 * every request through an injected `loadUser`, so a role grant OR
 * revocation takes effect on the very next request — never at the next
 * login (hub-audit §2.2: the old `requireRole` read the mint-time
 * `session.roles` snapshot, so a revoked admin stayed an admin until
 * logout).
 *
 * Kept free of the Mongo accessors so the allow/deny rules are
 * unit-testable with a fake loader (see capability-guard.test.ts). The
 * production guards in require-capability.ts / require-role.ts bind the
 * real users-collection loader.
 */

import type { NextFunction, Request, Response } from "express";
import type { ObjectId } from "mongodb";
import {
  resolveCapabilities,
  type Capability,
} from "@espace-devhub/shared/capabilities";
import type { UserRole } from "../db/types.js";
import { HttpError } from "./error-handler.js";

/** The user fields a guard needs. `status` is optional for legacy rows. */
export interface GuardUser {
  role: UserRole;
  roles?: UserRole[] | null;
  status?: string;
}

export type LoadGuardUser = (
  userId: ObjectId,
  orgId: ObjectId,
) => Promise<GuardUser | null>;

export type Middleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

function rolesOf(u: GuardUser): UserRole[] {
  return Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : [u.role];
}

/**
 * Resolve the current user for a guard, or an HttpError explaining why
 * not. A missing or disabled account is a 401 — the session outlived the
 * account (disabling signs a user out; this closes the in-flight window).
 */
async function currentUser(
  req: Request,
  loadUser: LoadGuardUser,
): Promise<GuardUser | HttpError> {
  if (!req.session) {
    // Defensive — `requireAuth` should run first.
    return new HttpError(401, "unauthenticated", "Login required.");
  }
  const user = await loadUser(req.session.userId, req.session.orgId);
  if (!user || user.status === "disabled") {
    return new HttpError(401, "unauthenticated", "Login required.");
  }
  return user;
}

/**
 * Build a capability guard. `mode: "all"` needs every listed capability
 * (the `requireCapability` contract); `mode: "any"` needs at least one.
 */
export function capabilityGuard(
  required: readonly Capability[],
  mode: "all" | "any",
  loadUser: LoadGuardUser,
): Middleware {
  if (required.length === 0) {
    throw new Error("capabilityGuard: at least one capability must be specified");
  }
  return async (req, _res, next) => {
    try {
      const user = await currentUser(req, loadUser);
      if (user instanceof HttpError) return next(user);
      const held = resolveCapabilities(rolesOf(user));
      const ok =
        mode === "all"
          ? required.every((cap) => held.has(cap))
          : required.some((cap) => held.has(cap));
      if (!ok) {
        return next(
          new HttpError(
            403,
            "forbidden",
            `Requires capability: ${required.join(mode === "all" ? ", " : " or ")}.`,
          ),
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Build a role guard: the user must CURRENTLY hold one of `allowed`. */
export function roleGuard(
  allowed: readonly UserRole[],
  loadUser: LoadGuardUser,
): Middleware {
  if (allowed.length === 0) {
    throw new Error("roleGuard: at least one role must be specified");
  }
  return async (req, _res, next) => {
    try {
      const user = await currentUser(req, loadUser);
      if (user instanceof HttpError) return next(user);
      const held = rolesOf(user);
      if (!allowed.some((r) => held.includes(r))) {
        return next(
          new HttpError(403, "forbidden", `Requires role: ${allowed.join(", ")}.`),
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
