/**
 * Route guard: requires an authenticated session whose user CURRENTLY
 * holds at least one of the allowed roles. 403 otherwise.
 *
 * Prefer `requireCapability` for new routes — roles grant capabilities,
 * and routes should name the capability they need (hub-audit §2.1). This
 * guard remains for the few call sites that still gate on a role.
 *
 * Always pair with `requireAuth` — this guard does NOT check session
 * presence (so the 401 vs 403 distinction stays correct: 401 = "log
 * in", 403 = "you're logged in but not allowed").
 *
 * Freshness (hub-audit §2.2): this used to read `req.session.roles`, the
 * effective-roles snapshot taken at login. A role REVOCATION therefore
 * stayed effective on admin routes until the user logged out — and two
 * freshness models guarded adjacent routes (requireCapability already
 * re-read the user). It now re-reads the user doc on every request, the
 * same way requireCapability does, via the shared loader. A disabled
 * account is refused with 401 even while its session lingers.
 *
 * Membership is checked across the user's FULL role set, never a single
 * "primary" role — which role sits first in the `roles` array is an
 * artifact of whatever UI or script wrote it, not an authorization
 * signal (the historic "admin-granted user kept 403-ing" bug).
 */

import type { UserRole } from "../db/types.js";
import { roleGuard, type Middleware } from "./capability-guard.js";
import { loadGuardUser } from "./require-capability.js";

export function requireRole(...allowed: UserRole[]): Middleware {
  if (allowed.length === 0) {
    throw new Error("requireRole: at least one role must be specified");
  }
  return roleGuard(allowed, loadGuardUser);
}
