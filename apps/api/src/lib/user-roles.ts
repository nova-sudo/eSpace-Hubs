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
 * Primary role used in places that need ONE value (session.role,
 * audit.actorRole, etc.). Convention: first element of the effective
 * roles list, which the migration arranges so the "most operational"
 * role is first (admin > manager > qa > dev > member > hr > po).
 */
export function primaryRole(u: Pick<User, "role" | "roles">): UserRole {
  const roles = effectiveRoles(u);
  return roles[0];
}
