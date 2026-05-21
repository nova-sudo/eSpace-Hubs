/**
 * Bearer-token authentication helper for companion devices.
 *
 * The catch-all-routing endpoints (/me/companion-tunnel, /me/api-origin)
 * are called by BOTH the browser (signed-cookie session) AND the
 * companion app (Authorization: Bearer <token>). This helper resolves
 * EITHER source into a normalised principal object so the controllers
 * don't have to fork on auth-mechanism.
 *
 * Cookie path:
 *   Reads `req.session` as populated by sessionMiddleware. If present,
 *   the user is browser-authenticated; return their userId + orgId.
 *
 * Bearer path:
 *   Reads `Authorization: Bearer <token>`. Hashes the token, looks it
 *   up by hash on companion_devices, rejects revoked rows. On match,
 *   `lastUsedAt` is bumped (throttled — see below) and the row's
 *   userId + orgId become the principal.
 *
 * Returns null if neither mechanism produces a valid principal. The
 * caller throws HttpError 401.
 *
 * lastUsedAt throttle:
 *   We avoid a DB write on every authenticated request — a chatty
 *   companion would issue dozens per minute. The in-process Map below
 *   debounces to one write per device per minute. On a multi-process
 *   deploy this just means each process has its own debounce window,
 *   which is fine — it's a cache-not-correctness field.
 */

import type { Request } from "express";
import { createHash } from "node:crypto";
import type { ObjectId } from "mongodb";
import { getCompanionDevicesCollection } from "../../db/collections.js";
import type { UserRole } from "../../db/types.js";
import { getUsersCollection } from "../../db/collections.js";
import { logger } from "../../lib/logger.js";

export interface CompanionPrincipal {
  userId: ObjectId;
  orgId: ObjectId;
  /** The session's role if cookie-authed, else the user's role. Used
   *  for audit logging. */
  role: UserRole;
  /** How the principal was authenticated — "session" or "bearer". */
  source: "session" | "bearer";
  /** The CompanionDevice id when source === "bearer", else null. */
  deviceId: ObjectId | null;
}

function hashToken(plaintext: string): string {
  return createHash("sha256")
    .update(plaintext, "utf8")
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const LAST_USED_THROTTLE_MS = 60 * 1000;
const lastUsedTouch = new Map<string, number>();

/**
 * Resolve the caller into a CompanionPrincipal. Tries session first
 * (no DB hit beyond what the session middleware already did), then
 * falls back to Bearer. Returns null on no valid auth.
 */
export async function resolveCompanionPrincipal(
  req: Request,
): Promise<CompanionPrincipal | null> {
  if (req.session) {
    return {
      userId: req.session.userId,
      orgId: req.session.orgId,
      role: req.session.role,
      source: "session",
      deviceId: null,
    };
  }

  const header = req.headers["authorization"];
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const plaintext = match[1]!.trim();
  if (!plaintext) return null;

  const tokenHash = hashToken(plaintext);
  const devices = await getCompanionDevicesCollection();
  const row = await devices.findOne({ tokenHash, revokedAt: null });
  if (!row) return null;

  // Throttled lastUsedAt bump — see header comment.
  const key = row._id.toHexString();
  const now = Date.now();
  const last = lastUsedTouch.get(key) ?? 0;
  if (now - last >= LAST_USED_THROTTLE_MS) {
    lastUsedTouch.set(key, now);
    void devices
      .updateOne({ _id: row._id }, { $set: { lastUsedAt: new Date(now) } })
      .catch((err: unknown) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "[companion.bearer] lastUsedAt bump failed",
        );
      });
  }

  // Look up user role for audit-log fidelity. If the user doesn't
  // exist anymore the device row is effectively orphaned — reject.
  const users = await getUsersCollection();
  const user = await users.findOne({ _id: row.userId });
  if (!user) return null;

  return {
    userId: row.userId,
    orgId: row.orgId,
    role: user.role,
    source: "bearer",
    deviceId: row._id,
  };
}
