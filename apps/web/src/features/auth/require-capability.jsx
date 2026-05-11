"use client";

/**
 * Capability gate for UI elements.
 *
 * Usage:
 *   <RequireCapability cap="admin.users.manage">
 *     <Link href={link("/users")}>Manage users</Link>
 *   </RequireCapability>
 *
 * Renders children only when the active session has the capability;
 * otherwise renders null (or the optional `fallback`). The server is
 * the authoritative gate — the session's `capabilities` array ships
 * from /auth/me, computed server-side from the user's roles.
 *
 * Multiple required capabilities: pass `caps={["a", "b"]}`. The match
 * is AND — every cap must be in the user's set.
 *
 * Loading state: when the session hasn't resolved yet, renders
 * `fallback` (or null). This avoids a flash of gated content during
 * the auth-hydration window.
 */

import { useSession } from "./use-session.js";

export function RequireCapability({
  cap,
  caps,
  fallback = null,
  children,
}) {
  const { user, loading } = useSession();
  const required = cap ? [cap] : Array.isArray(caps) ? caps : [];

  if (loading) return fallback;
  if (!user) return fallback;

  const userCaps = Array.isArray(user.capabilities) ? user.capabilities : [];
  for (const r of required) {
    if (!userCaps.includes(r)) return fallback;
  }
  return children;
}

/**
 * Non-React reader. Returns true if the user holds ALL of the
 * required capabilities. Use inside event handlers or non-component
 * code (e.g. command-palette commands that need to filter by cap).
 */
export function hasCapability(user, cap) {
  if (!user || !Array.isArray(user.capabilities)) return false;
  return user.capabilities.includes(cap);
}

export function hasAllCapabilities(user, caps) {
  if (!user || !Array.isArray(user.capabilities)) return false;
  if (!Array.isArray(caps) || caps.length === 0) return true;
  return caps.every((c) => user.capabilities.includes(c));
}
