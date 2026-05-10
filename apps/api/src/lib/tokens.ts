/**
 * One-time token helpers — invites and password resets.
 *
 * Plaintext / hash split:
 *   - The plaintext token (32 random bytes, base64url) is what the
 *     user sees in the email link.
 *   - Mongo stores the SHA-256 hash of the plaintext as `_id`.
 *   - To verify a redemption, hash the candidate the same way and
 *     look it up.
 *
 * Why hashed vs plain:
 *   - High-entropy random — no need for a slow KDF (argon2id), but
 *     storing plaintext means a Mongo-only compromise yields live
 *     tokens. SHA-256 closes that.
 *   - Cheap (microseconds), so verifying is fast.
 *
 * Single-use enforcement is a 2-step pattern:
 *   1. atomically findOneAndUpdate setting usedAt — if `usedAt` was
 *      already non-null, the matched doc count is 0
 *   2. only treat the token as valid if step 1 reported a fresh hit
 *
 * Concurrent redemptions race on a single Mongo write; the loser
 * sees `null`. No locks, no app-side mutex.
 */

import { createHash, randomBytes } from "node:crypto";
import type { ObjectId } from "mongodb";
import { getAuthTokensCollection } from "../db/collections.js";
import type { AuthToken, AuthTokenKind } from "../db/types.js";
import { logger } from "./logger.js";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function newPlaintext(): string {
  return randomBytes(32)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function hashToken(plaintext: string): string {
  return createHash("sha256")
    .update(plaintext, "utf8")
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export interface MintTokenInput {
  userId: ObjectId;
  orgId: ObjectId;
  kind: AuthTokenKind;
  ttlMs: number;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Mint a fresh one-time token. Invalidates any prior tokens of the
 * same kind for the same user — a new password-reset request voids
 * the previous link, a re-issued invite voids the old link.
 *
 * Returns the PLAINTEXT — that's what goes in the email. The DB only
 * sees the hash.
 */
export async function mintToken(input: MintTokenInput): Promise<string> {
  const plaintext = newPlaintext();
  const id = hashToken(plaintext);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlMs);

  const col = await getAuthTokensCollection();
  // Wipe prior tokens of the same kind first.
  await col.deleteMany({ userId: input.userId, kind: input.kind });

  const doc: AuthToken = {
    _id: id,
    userId: input.userId,
    orgId: input.orgId,
    kind: input.kind,
    createdAt: now,
    expiresAt,
    usedAt: null,
    createdByIp: input.ip,
    createdByUa: input.userAgent,
  };
  await col.insertOne(doc);

  return plaintext;
}

/**
 * Atomically redeem a token. Returns the (now-marked-used) row on
 * success, null on any failure mode (missing, expired, already used,
 * wrong kind).
 *
 * Caller MUST ignore null and treat all failures identically — never
 * reveal whether the token was wrong vs expired vs used.
 */
export async function redeemToken(
  plaintextCandidate: string,
  expectedKind: AuthTokenKind,
): Promise<AuthToken | null> {
  if (typeof plaintextCandidate !== "string" || !plaintextCandidate) {
    return null;
  }
  const id = hashToken(plaintextCandidate);
  const now = new Date();
  const col = await getAuthTokensCollection();

  // findOneAndUpdate is atomic — concurrent redemptions race here.
  const result = await col.findOneAndUpdate(
    {
      _id: id,
      kind: expectedKind,
      usedAt: null,
      expiresAt: { $gt: now },
    },
    { $set: { usedAt: now } },
    { returnDocument: "after" },
  );

  if (!result) return null;
  return result;
}

/**
 * Best-effort cleanup hook. The TTL index handles steady-state cleanup;
 * this is for the rare case of explicit user-initiated invalidation
 * (e.g. "this user just changed their password — kill any pending
 * resets").
 */
export async function deleteTokensFor(
  userId: ObjectId,
  kind?: AuthTokenKind,
): Promise<void> {
  try {
    const col = await getAuthTokensCollection();
    const filter = kind ? { userId, kind } : { userId };
    await col.deleteMany(filter);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[tokens] deleteTokensFor failed",
    );
  }
}
