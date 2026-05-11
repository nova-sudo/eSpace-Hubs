/**
 * Type signatures for roles + role→capability resolution. Runtime in
 * roles.js.
 */

import type { Capability } from "./capabilities.js";

export const ROLES: Readonly<{
  readonly ADMIN: "admin";
  readonly DEV: "dev";
  readonly QA: "qa";
  readonly MANAGER: "manager";
  readonly HR: "hr";
  readonly PO: "po";
}>;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: readonly Role[];

export const ROLE_CAPABILITIES: Readonly<Record<Role, readonly Capability[]>>;

/**
 * Returns a Set of every capability granted by the union of roles.
 * Unknown role ids are silently filtered out.
 */
export function resolveCapabilities(
  roles: readonly string[] | null | undefined,
): Set<Capability>;

/**
 * True if `userCaps` satisfies every requirement in `requires`.
 * Empty `requires` returns true (open surface).
 */
export function hasCapabilities(
  userCaps: Set<Capability>,
  requires: readonly Capability[] | null | undefined,
): boolean;
