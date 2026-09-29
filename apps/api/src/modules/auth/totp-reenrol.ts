/**
 * Self-service two-factor RE-ENROLMENT — "move to a new phone" without
 * an admin.
 *
 *   start   — proves KNOWLEDGE (password) AND POSSESSION of the old
 *             factor (a current authenticator code, an unused backup
 *             code, or a session that was itself verified with a backup
 *             code in the last few minutes). Mints a PENDING secret,
 *             stored encrypted next to the live one. The live secret
 *             keeps working until confirm, so cancelling at any point
 *             leaves the old phone in charge.
 *   confirm — a code from the NEW app, checked against the pending
 *             secret, swaps it in with a single conditional update and
 *             issues a fresh set of backup codes (every old one dies in
 *             the same write).
 *
 * Ordering rule in `start`: the password is checked BEFORE the factor,
 * so a wrong password never burns a backup code.
 *
 * Pure apart from the collection surface and crypto helpers it is
 * handed — no env import — so it is unit-testable without Mongo.
 */

import type { ObjectId } from "mongodb";
import {
  consumeBackupCode,
  countRemainingBackupCodes,
  generateBackupCodes,
  toStoredBackupCodes,
  type StoredBackupCode,
} from "./backup-codes.js";

/** A pending (unconfirmed) new secret lives this long. */
export const REENROL_PENDING_TTL_MS = 15 * 60 * 1000;

/**
 * A session verified with a backup code at sign-in may start a
 * re-enrolment without spending ANOTHER backup code for this long.
 */
export const BACKUP_CODE_SESSION_WINDOW_MS = 10 * 60 * 1000;

/** Error with an HTTP status + stable code; the controller maps it. */
export class ReenrolError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReenrolError";
  }
}

/** The user fields this module reads. `User` satisfies it. */
export interface ReenrolUser {
  _id: ObjectId;
  email: string;
  passwordHash: string | null;
  totpSecret: string | null;
  totpEnrolledAt: Date | null;
  totpPendingSecret?: string | null;
  totpPendingExpiresAt?: Date | null;
  totpBackupCodes?: StoredBackupCode[] | null;
}

/** Slice of `Collection<User>` used here (structurally satisfied). */
export interface ReenrolStore {
  findOne(filter: object): Promise<ReenrolUser | null>;
  updateOne(filter: object, update: object): Promise<{ modifiedCount: number }>;
}

export interface ReenrolDeps {
  store: ReenrolStore;
  /** Backup-code HMAC key (SESSION_SECRET in production). */
  pepper: string;
  verifyPassword(plain: string, hash: string): Promise<boolean>;
  verifyTotp(code: string, secret: string): boolean;
  encrypt(plain: string): string;
  decrypt(envelope: string): string;
  generateSecret(): string;
  provisioningUri(email: string, secret: string): string;
  now?: () => Date;
}

export interface StartInput {
  password: string;
  code?: string;
  backupCode?: string;
}

export type ReenrolFactor = "totp" | "backup_code" | "backup_code_session";

export interface StartResult {
  secret: string;
  otpauthUrl: string;
  expiresAt: Date;
  factor: ReenrolFactor;
  backupCodesRemaining: number;
}

/**
 * True when this session cleared login step 2 with a backup code
 * recently enough to count as proof of the old factor.
 */
export function isRecentBackupCodeSession(
  verifiedWithBackupCodeAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!(verifiedWithBackupCodeAt instanceof Date)) return false;
  const age = now.getTime() - verifiedWithBackupCodeAt.getTime();
  return age >= 0 && age <= BACKUP_CODE_SESSION_WINDOW_MS;
}

function requireEnrolled(user: ReenrolUser | null): asserts user is ReenrolUser & {
  totpSecret: string;
  totpEnrolledAt: Date;
} {
  if (!user) throw new ReenrolError(401, "unauthenticated", "Login required.");
  if (user.totpEnrolledAt === null || user.totpSecret === null) {
    throw new ReenrolError(409, "totp_not_enrolled", "Two-factor is not enabled.");
  }
}

/** Step 1 — verify password + old factor, stash a pending secret. */
export async function startReenrol(
  deps: ReenrolDeps,
  userId: ObjectId,
  input: StartInput,
  session: { verifiedWithBackupCodeAt?: Date | null },
): Promise<StartResult> {
  const now = deps.now?.() ?? new Date();
  const user = await deps.store.findOne({ _id: userId });
  requireEnrolled(user);

  // Knowledge first — a wrong password must not consume a backup code.
  const passwordOk =
    user.passwordHash !== null &&
    (await deps.verifyPassword(input.password, user.passwordHash));
  if (!passwordOk) {
    throw new ReenrolError(401, "invalid_password", "Password did not match.");
  }

  let factor: ReenrolFactor;
  let backupCodesRemaining = countRemainingBackupCodes(user.totpBackupCodes);
  if (typeof input.code === "string") {
    let live: string;
    try {
      live = deps.decrypt(user.totpSecret);
    } catch {
      throw new ReenrolError(500, "totp_secret_corrupted", "Internal error.");
    }
    if (!deps.verifyTotp(input.code, live)) {
      throw new ReenrolError(401, "invalid_totp_code", "Code did not match.");
    }
    factor = "totp";
  } else if (typeof input.backupCode === "string") {
    const remaining = await consumeBackupCode(
      deps.store,
      user._id,
      input.backupCode,
      deps.pepper,
      now,
    );
    if (remaining === null) {
      throw new ReenrolError(
        401,
        "invalid_backup_code",
        "Backup code did not match or was already used.",
      );
    }
    backupCodesRemaining = remaining;
    factor = "backup_code";
  } else if (isRecentBackupCodeSession(session.verifiedWithBackupCodeAt, now)) {
    factor = "backup_code_session";
  } else {
    throw new ReenrolError(
      400,
      "factor_required",
      "Enter a code from your authenticator app or one of your backup codes.",
    );
  }

  const secret = deps.generateSecret();
  const expiresAt = new Date(now.getTime() + REENROL_PENDING_TTL_MS);
  await deps.store.updateOne(
    { _id: user._id },
    {
      $set: {
        totpPendingSecret: deps.encrypt(secret),
        totpPendingExpiresAt: expiresAt,
        updatedAt: now,
      },
    },
  );

  return {
    secret,
    otpauthUrl: deps.provisioningUri(user.email, secret),
    expiresAt,
    factor,
    backupCodesRemaining,
  };
}

/** Step 2 — verify a code from the new app, swap secrets, reissue codes. */
export async function confirmReenrol(
  deps: ReenrolDeps,
  userId: ObjectId,
  code: string,
): Promise<{ backupCodes: string[]; previousBackupCodesRemaining: number }> {
  const now = deps.now?.() ?? new Date();
  const user = await deps.store.findOne({ _id: userId });
  requireEnrolled(user);

  const pending = user.totpPendingSecret ?? null;
  const expiresAt = user.totpPendingExpiresAt ?? null;
  if (pending === null || !(expiresAt instanceof Date)) {
    throw new ReenrolError(
      400,
      "reenrol_not_started",
      "No move in progress. Start again from Settings → Account.",
    );
  }
  if (expiresAt.getTime() <= now.getTime()) {
    throw new ReenrolError(
      400,
      "reenrol_expired",
      "That setup expired. Start again to get a fresh QR code.",
    );
  }

  let plainPending: string;
  try {
    plainPending = deps.decrypt(pending);
  } catch {
    throw new ReenrolError(
      400,
      "reenrol_expired",
      "That setup could not be read. Start again to get a fresh QR code.",
    );
  }
  if (!deps.verifyTotp(code, plainPending)) {
    throw new ReenrolError(401, "invalid_totp_code", "Code did not match.");
  }

  // One conditional write: only swaps if the pending secret we just
  // verified is still the one on file and still live. A concurrent
  // second `start` (new pending) or a disable in between makes this a
  // no-op instead of installing a secret nobody has.
  const backupCodes = generateBackupCodes();
  const res = await deps.store.updateOne(
    {
      _id: user._id,
      totpEnrolledAt: { $ne: null },
      totpPendingSecret: pending,
      totpPendingExpiresAt: { $gt: now },
    },
    {
      $set: {
        totpSecret: pending,
        totpEnrolledAt: now,
        totpPendingSecret: null,
        totpPendingExpiresAt: null,
        totpBackupCodes: toStoredBackupCodes(backupCodes, deps.pepper),
        totpBackupCodesGeneratedAt: now,
        updatedAt: now,
      },
    },
  );
  if (res.modifiedCount !== 1) {
    throw new ReenrolError(
      409,
      "reenrol_superseded",
      "This setup was replaced or cancelled. Start again.",
    );
  }

  return {
    backupCodes,
    previousBackupCodesRemaining: countRemainingBackupCodes(user.totpBackupCodes),
  };
}
