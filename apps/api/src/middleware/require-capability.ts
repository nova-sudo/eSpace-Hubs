/**
 * Route guards: require an authenticated session whose user CURRENTLY
 * holds the given capabilities. 403 otherwise.
 *
 *   requireCapability(a, b)     — must hold ALL of them
 *   requireAnyCapability(a, b)  — must hold AT LEAST ONE (e.g. a
 *                                 lightweight roster read both the
 *                                 user-management and the audit page
 *                                 need)
 *
 * Always pair with `requireAuth` (which establishes the session and 401s
 * when it's absent) — these guards only check authorisation, so the
 * 401-vs-403 split stays correct.
 *
 * Resolution: capabilities are computed from the user's FULL role set,
 * read fresh from the users collection by `session.userId` on every
 * request. Deliberately NOT from the session's role snapshot:
 *
 *   - Multi-role correctness: a user who is `admin` AND `manager` has
 *     `admin` as their primary role, so a primary-role check would deny
 *     them `manager.team.view` even though they hold the manager role.
 *   - Freshness: a role grant or REVOCATION takes effect on the next
 *     request — no re-login to re-mint the session (hub-audit §2.2).
 *   - A disabled account is refused (401) even while a session lingers.
 *
 * Cost: one indexed user lookup per guarded request. Negligible.
 *
 * The allow/deny logic lives in ./capability-guard.ts (DB-free, tested).
 */

import type { Capability } from "@espace-devhub/shared/capabilities";
import { getUsersCollection } from "../db/collections.js";
import {
  capabilityGuard,
  type LoadGuardUser,
  type Middleware,
} from "./capability-guard.js";

/** The production loader: the user row, scoped to the session's org. */
export const loadGuardUser: LoadGuardUser = async (userId, orgId) => {
  const users = await getUsersCollection();
  return users.findOne(
    { _id: userId, orgId },
    { projection: { role: 1, roles: 1, status: 1 } },
  );
};

export function requireCapability(...required: Capability[]): Middleware {
  if (required.length === 0) {
    throw new Error(
      "requireCapability: at least one capability must be specified",
    );
  }
  return capabilityGuard(required, "all", loadGuardUser);
}

export function requireAnyCapability(...required: Capability[]): Middleware {
  if (required.length === 0) {
    throw new Error(
      "requireAnyCapability: at least one capability must be specified",
    );
  }
  return capabilityGuard(required, "any", loadGuardUser);
}
