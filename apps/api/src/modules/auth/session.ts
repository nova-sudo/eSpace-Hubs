/**
 * Session lifecycle. Mints, looks up, touches, and destroys session
 * docs in Mongo. Never exposes the raw `_id` outside this module — the
 * caller passes it through the cookie.
 *
 * IDs: 32 random bytes encoded as base64url (43 chars). 256-bit entropy.
 * Indistinguishable from random — no metadata leaks (unlike ObjectIds,
 * which leak timestamp + machine id).
 *
 * TTL: persisted on the doc as `expiresAt`. Mongo's TTL monitor evicts
 * dead rows asynchronously (~60s sweep), so the auth middleware also
 * checks `expiresAt > now()` defensively to handle the gap.
 *
 * Sliding expiry: every successful auth refreshes `lastSeenAt` and
 * extends `expiresAt`. If a session is idle past its TTL, Mongo will
 * have evicted it before the cookie becomes a problem.
 */

import { randomBytes } from "node:crypto";
import type { ObjectId } from "mongodb";
import { getSessionsCollection } from "../../db/collections.js";
import type { Session, UserRole } from "../../db/types.js";

/** 12 hours sliding window. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Touch threshold: only update `lastSeenAt` / `expiresAt` if the session
 * is "older" than this. Without this every authenticated request would
 * write to Mongo. 60s is long enough to dedupe noisy clients and short
 * enough that idle timeout still feels accurate.
 */
const TOUCH_THROTTLE_MS = 60 * 1000;

function newSessionId(): string {
  // base64url, no padding. 32 bytes → 43 chars.
  return randomBytes(32)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export interface MintSessionInput {
  userId: ObjectId;
  orgId: ObjectId;
  role: UserRole;
  ip: string | null;
  userAgent: string | null;
  /** Whether the second factor was satisfied. M2.3c onwards toggles
   *  this true after a TOTP verify; for now always true (no TOTP
   *  enforcement yet). */
  totpVerified?: boolean;
  /**
   * Snapshot of whether the user had TOTP enrolled at session-mint
   * time. Read by `requireAuth({requireTotpEnrolled: true})`. Login
   * passes `u.totpEnrolledAt !== null`; accept-invite passes `false`
   * because the new user can't have enrolled yet.
   *
   * Defaults to `true` so existing callers that don't pass anything
   * don't suddenly lock users out — but every caller in the auth
   * controller passes an explicit value.
   */
  totpEnrolled?: boolean;
}

/** Mint a new session and return the cookie-bound id. */
export async function mintSession(input: MintSessionInput): Promise<{
  sessionId: string;
  expiresAt: Date;
}> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const sessionId = newSessionId();

  const doc: Session = {
    _id: sessionId,
    userId: input.userId,
    orgId: input.orgId,
    role: input.role,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
    ip: input.ip,
    userAgent: input.userAgent,
    totpVerified: input.totpVerified ?? true,
    totpEnrolled: input.totpEnrolled ?? true,
  };

  const col = await getSessionsCollection();
  await col.insertOne(doc);
  return { sessionId, expiresAt };
}

/**
 * Look up a session by id. Returns null if missing or expired (defensive
 * — Mongo's TTL eviction is async, so we cross-check the timestamp).
 */
export async function lookupSession(sessionId: string): Promise<Session | null> {
  if (!sessionId || typeof sessionId !== "string") return null;
  const col = await getSessionsCollection();
  const session = await col.findOne({ _id: sessionId });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    // Best-effort eager cleanup. Failure here is fine — TTL gets it.
    void col.deleteOne({ _id: sessionId }).catch(() => {});
    return null;
  }
  return session;
}

/**
 * Bump `lastSeenAt` and extend `expiresAt`. Throttled (TOUCH_THROTTLE_MS)
 * so a busy session doesn't write to Mongo on every request.
 */
export async function touchSession(session: Session): Promise<Date> {
  const now = Date.now();
  const ageSinceTouch = now - session.lastSeenAt.getTime();
  if (ageSinceTouch < TOUCH_THROTTLE_MS) {
    return session.expiresAt;
  }
  const newExpiresAt = new Date(now + SESSION_TTL_MS);
  const col = await getSessionsCollection();
  await col.updateOne(
    { _id: session._id },
    { $set: { lastSeenAt: new Date(now), expiresAt: newExpiresAt } },
  );
  return newExpiresAt;
}

/** Destroy a single session (logout). */
export async function destroySession(sessionId: string): Promise<void> {
  const col = await getSessionsCollection();
  await col.deleteOne({ _id: sessionId });
}

/**
 * Flip a session's `totpVerified` flag. Called after a successful
 * second-factor challenge. The session middleware re-reads the row on
 * every request, so the next request after this update sees the new
 * value — no need to mint a fresh session.
 */
export async function setSessionTotpVerified(
  sessionId: string,
  verified: boolean,
): Promise<void> {
  const col = await getSessionsCollection();
  await col.updateOne(
    { _id: sessionId },
    { $set: { totpVerified: verified } },
  );
}

/**
 * Flip a session's `totpEnrolled` flag. Called after a successful
 * /auth/totp/verify-enrolment so subsequent requests pass
 * `requireAuth({requireTotpEnrolled: true})` without a user-doc
 * lookup. Also called from /auth/totp/disable to flip it back to
 * false (the user immediately loses non-enrol-gated access until
 * they re-enrol).
 */
export async function setSessionTotpEnrolled(
  sessionId: string,
  enrolled: boolean,
): Promise<void> {
  const col = await getSessionsCollection();
  await col.updateOne(
    { _id: sessionId },
    { $set: { totpEnrolled: enrolled } },
  );
}

/** Destroy every session belonging to a user (forced logout, password change). */
export async function destroySessionsForUser(userId: ObjectId): Promise<number> {
  const col = await getSessionsCollection();
  const res = await col.deleteMany({ userId });
  return res.deletedCount ?? 0;
}
