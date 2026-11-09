/**
 * Retire account approval (frictionless signup, 2026-11).
 *
 * Self-signups used to wait in `pending_admin` until an admin
 * approved them. Nothing assigns that status anymore; any rows still
 * parked there are promoted to `active` on boot. Idempotent — a second
 * run matches nothing.
 */

import type { Collection } from "mongodb";
import type { User } from "../types.js";

export async function migratePendingAdminToActive(
  users: Pick<Collection<User>, "updateMany">,
): Promise<{ updated: number }> {
  const r = await users.updateMany(
    { status: "pending_admin" },
    { $set: { status: "active", updatedAt: new Date() } },
  );
  return { updated: r.modifiedCount };
}
