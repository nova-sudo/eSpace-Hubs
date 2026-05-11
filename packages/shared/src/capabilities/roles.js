/**
 * Roles → capability sets.
 *
 * A user's effective capabilities = union of the capabilities granted
 * by each role they hold. Multi-role is the design — `users.roles` is
 * an array. An admin who also needs to navigate Dev gets both
 * `admin` AND `dev` as roles.
 *
 * Adding a new role:
 *   1. Add a key here mapping role id → capability array
 *   2. Add the role id to ALL_USER_ROLES in apps/api/src/db/types.ts
 *   3. (If the role drives onboarding) extend the department→role
 *      lookup in onboarding.
 */

import { CAPABILITIES } from "./capabilities.js";

/**
 * Stable role ids. New users get roles from this list; existing
 * users with deprecated roles get migrated (see the migration in
 * apps/api/src/db/migrations).
 */
export const ROLES = Object.freeze({
  ADMIN: "admin",
  DEV: "dev",
  QA: "qa",
  MANAGER: "manager",
  HR: "hr",
  PO: "po",
});

export const ALL_ROLES = Object.freeze(Object.values(ROLES));

/**
 * Each role's capability grants. Frozen arrays so callers can't
 * accidentally mutate the registry.
 *
 * Design intent:
 *   - Each operational role grants exactly ONE hub-access capability
 *     plus the role-specific operational caps. A manager who needs to
 *     see Dev work has roles: ["manager", "dev"] — multi-role is
 *     the composition mechanism, not "manager grants everything".
 *   - HR and PO are reserved — they exist as role ids so an admin
 *     can grant them today, but their hubs (and any HR/PO-specific
 *     capabilities) ship later when those hubs land.
 */
export const ROLE_CAPABILITIES = Object.freeze({
  [ROLES.ADMIN]: Object.freeze([
    CAPABILITIES.HUB_ADMIN_ACCESS,
    CAPABILITIES.ADMIN_USERS_MANAGE,
    CAPABILITIES.ADMIN_HUBS_CONFIGURE,
    CAPABILITIES.ADMIN_AUDIT_VIEW,
  ]),

  [ROLES.DEV]: Object.freeze([CAPABILITIES.HUB_DEV_ACCESS]),

  [ROLES.QA]: Object.freeze([CAPABILITIES.HUB_QA_ACCESS]),

  [ROLES.MANAGER]: Object.freeze([
    CAPABILITIES.HUB_MANAGER_ACCESS,
    CAPABILITIES.MANAGER_TEAM_VIEW,
  ]),

  [ROLES.HR]: Object.freeze([
    // CAPABILITIES.HUB_HR_ACCESS reserved — uncommented when the
    // HR hub ships
  ]),

  [ROLES.PO]: Object.freeze([
    // CAPABILITIES.HUB_PO_ACCESS reserved
  ]),
});

/**
 * Returns the union of capabilities for a set of roles. Unknown role
 * ids are silently filtered out — a stale role id on a user row
 * doesn't crash the resolver.
 *
 * Result is a Set for cheap membership checks downstream.
 */
export function resolveCapabilities(roles) {
  const caps = new Set();
  if (!Array.isArray(roles)) return caps;
  for (const roleId of roles) {
    const grants = ROLE_CAPABILITIES[roleId];
    if (!grants) continue;
    for (const cap of grants) caps.add(cap);
  }
  return caps;
}

/**
 * True if the user's capabilities satisfy every requirement in the
 * `requires` list. Empty requires list is allowed (a hub with no
 * gates lets everyone in — used for any future public surface).
 */
export function hasCapabilities(userCapsSet, requires) {
  if (!Array.isArray(requires) || requires.length === 0) return true;
  for (const cap of requires) {
    if (!userCapsSet.has(cap)) return false;
  }
  return true;
}
