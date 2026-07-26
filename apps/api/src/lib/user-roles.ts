/**
 * Read helpers for the M-CAP multi-role model.
 *
 * Compatibility shim: until the schema migration removes the singular
 * `users.role` column, readers go through `effectiveRoles(u)` which
 * returns:
 *   - `u.roles` when it's a non-empty array
 *   - `[u.role]` otherwise (fallback for pre-migration rows)
 *
 * Use `effectiveCapabilities(u)` to get the Set of capabilities the
 * user holds via their union of roles.
 */

import {
  resolveCapabilities,
  type Capability,
} from "@espace-devhub/shared/capabilities";
import type { User, UserRole } from "../db/types.js";

export function effectiveRoles(u: Pick<User, "role" | "roles">): UserRole[] {
  if (Array.isArray(u.roles) && u.roles.length > 0) return u.roles as UserRole[];
  return [u.role];
}

export function effectiveCapabilities(
  u: Pick<User, "role" | "roles">,
): Set<Capability> {
  return resolveCapabilities(effectiveRoles(u));
}

/**
 * Seniority order for deriving a single "primary" role out of a
 * multi-role array — highest-privilege first. Used ONLY for display /
 * audit purposes (session.role, audit.actorRole); never for
 * authorization — see the doc comment on `requireRole` for why.
 */
const ROLE_PRIORITY: readonly UserRole[] = [
  "admin",
  "manager",
  "qa",
  "dev",
  "member",
  "hr",
  "po",
];

/**
 * Primary role used in places that need ONE value (session.role,
 * audit.actorRole, etc.) — display purposes only. Picks the
 * highest-seniority role the user holds via ROLE_PRIORITY, NOT
 * `roles[0]`: the roles array is written in whatever order a caller
 * assembled it (e.g. the admin UI's role-toggle appends newly-checked
 * roles to the end), so "first element" silently stopped meaning
 * "primary" the moment someone was granted a second role. That bug is
 * exactly what caused a freshly-admin-granted user's session to keep
 * minting with role "dev" (their original role) forever, 403-ing every
 * admin-only route despite `roles` correctly containing "admin" — see
 * requireRole's doc comment for the authorization-side fix.
 */
export function primaryRole(u: Pick<User, "role" | "roles">): UserRole {
  const roles = effectiveRoles(u);
  for (const candidate of ROLE_PRIORITY) {
    if (roles.includes(candidate)) return candidate;
  }
  return roles[0];
}
