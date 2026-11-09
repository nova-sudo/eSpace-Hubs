/**
 * Trusted browsers — skip the TOTP prompt for 30 days.
 *
 * After a successful TOTP code (never a backup code) the user may
 * trust the browser: it gets a random 32-byte token in the
 * `dh_trusted` cookie and we store only sha256(token). At login, after
 * the password check, a live row for the SAME user mints the session
 * as TOTP-verified. A cookie that belongs to someone else is ignored.
 *
 * Revoked wholesale on password reset, TOTP re-enrol/reset/disable,
 * admin disable and "Forget all". Logging out keeps the browser
 * trusted — that is the point (no code on every login).
 */

import { createHash, randomBytes } from "node:crypto";
import type { Collection, ObjectId } from "mongodb";
import type { TrustedDevice } from "../../db/types.js";

export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type TrustedDeviceStore = Pick<
  Collection<TrustedDevice>,
  "insertOne" | "findOneAndUpdate" | "deleteMany" | "deleteOne" | "countDocuments"
>;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueTrustedDevice(
  store: TrustedDeviceStore,
  input: {
    orgId: ObjectId;
    userId: ObjectId;
    ip: string | null;
    userAgent: string | null;
    now: Date;
  },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await store.insertOne({
    orgId: input.orgId,
    userId: input.userId,
    tokenHash: hashToken(token),
    userAgent: input.userAgent,
    ip: input.ip,
    createdAt: input.now,
    lastUsedAt: input.now,
    expiresAt: new Date(input.now.getTime() + TRUSTED_DEVICE_TTL_MS),
  } as TrustedDevice);
  return token;
}

export async function checkTrustedDevice(
  store: TrustedDeviceStore,
  token: string | null,
  userId: ObjectId,
  now: Date,
): Promise<boolean> {
  if (!token) return false;
  const hit = await store.findOneAndUpdate(
    { tokenHash: hashToken(token), userId, expiresAt: { $gt: now } },
    { $set: { lastUsedAt: now } },
  );
  return !!hit;
}

export async function revokeTrustedDevices(
  store: TrustedDeviceStore,
  userId: ObjectId,
): Promise<number> {
  const r = await store.deleteMany({ userId });
  return r.deletedCount;
}

export async function countTrustedDevices(
  store: TrustedDeviceStore,
  userId: ObjectId,
  now: Date,
): Promise<number> {
  return store.countDocuments({ userId, expiresAt: { $gt: now } });
}
