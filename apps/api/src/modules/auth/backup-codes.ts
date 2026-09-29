/**
 * Two-factor BACKUP CODES — the "lost my phone" escape hatch.
 *
 * On enrolment (and on every regenerate) the user gets 10 single-use
 * codes shaped `xxxx-xxxx`. Only a keyed hash of each code is stored,
 * next to a `usedAt` stamp; the plaintext is returned exactly once.
 *
 * Alphabet: Crockford base32, lowercase — digits + letters minus
 * i / l / o / u. 8 symbols × 5 bits = 40 bits of entropy per code,
 * drawn with `crypto.randomInt` (uniform, no modulo bias). Input is
 * normalised the Crockford way (case-folded, dashes/spaces dropped,
 * i/l → 1, o → 0) so a code read aloud or retyped from paper still
 * matches.
 *
 * Why HMAC-SHA256 (keyed by SESSION_SECRET) and not argon2:
 *   - argon2 is for LOW-entropy secrets a human chose. These codes are
 *     40 random bits, so a slow KDF buys nothing against offline
 *     guessing that the key doesn't already buy — without the server
 *     key a leaked hash is useless, and even with it 2^40 codes per
 *     entry is the search space.
 *   - Our argon2 profile costs 19 MiB + ~100 ms per verify. With a
 *     per-code salt the login step would have to try up to 10 of them
 *     serially — ~1 s of CPU and a memory spike per request, handed to
 *     anyone holding a partial (password-only) session. That is a DoS
 *     lever on the login path.
 *   - A deterministic keyed hash lets Mongo find AND consume the code
 *     in ONE conditional update (`$elemMatch {hash, usedAt: null}` +
 *     positional `$set`), which is what makes single use atomic: two
 *     concurrent requests with the same code can't both match an
 *     element whose `usedAt` is null.
 *   Trade-off: rotating SESSION_SECRET invalidates outstanding backup
 *   codes (users then regenerate, or an admin resets 2FA). Rotating it
 *   already logs everyone out, so it's an intentional event anyway.
 *
 * This module is pure apart from the tiny collection surface it takes
 * as a parameter — no env import — so it is unit-testable without a
 * database or process env.
 */

import { createHmac, randomInt } from "node:crypto";
import type { ObjectId } from "mongodb";

export const BACKUP_CODE_COUNT = 10;

/** Crockford base32, lowercase: 0-9 + a-z minus i, l, o, u (32 symbols). */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const GROUP = 4;

/** Stored shape of one code. `hash` is hex HMAC-SHA256 of the normalised code. */
export interface StoredBackupCode {
  hash: string;
  usedAt: Date | null;
}

/** Generate one plaintext code, `xxxx-xxxx`. */
export function generateBackupCode(): string {
  let out = "";
  for (let i = 0; i < GROUP * 2; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${out.slice(0, GROUP)}-${out.slice(GROUP)}`;
}

/** Generate `count` distinct plaintext codes. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const set = new Set<string>();
  while (set.size < count) set.add(generateBackupCode());
  return [...set];
}

/**
 * Canonical form used for hashing: lowercase, no separators, Crockford
 * look-alikes folded. Returns null when the input can't be a code, so
 * callers can reject without hashing.
 */
export function normalizeBackupCode(input: string): string | null {
  if (typeof input !== "string") return null;
  const s = input
    .toLowerCase()
    .replace(/[\s-]/g, "")
    .replace(/[il]/g, "1")
    .replace(/o/g, "0");
  if (s.length !== GROUP * 2) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return s;
}

/** Keyed hash of a normalised code. Domain-separated from other HMAC uses. */
export function hashBackupCode(normalized: string, pepper: string): string {
  return createHmac("sha256", pepper)
    .update("totp-backup-code:v1:")
    .update(normalized)
    .digest("hex");
}

/** Build the stored array for a fresh set of plaintext codes. */
export function toStoredBackupCodes(
  codes: string[],
  pepper: string,
): StoredBackupCode[] {
  return codes.map((c) => {
    const n = normalizeBackupCode(c);
    if (!n) throw new Error("toStoredBackupCodes: malformed generated code");
    return { hash: hashBackupCode(n, pepper), usedAt: null };
  });
}

/** Count of unused codes on a user doc (0 when none were ever issued). */
export function countRemainingBackupCodes(
  codes: StoredBackupCode[] | null | undefined,
): number {
  if (!Array.isArray(codes)) return 0;
  return codes.filter((c) => c.usedAt === null).length;
}

/**
 * The slice of a Mongo collection these helpers need. `Collection<User>`
 * satisfies it structurally; the tests pass an in-memory fake.
 */
export interface BackupCodeStore {
  updateOne(filter: object, update: object): Promise<{ modifiedCount: number }>;
  findOne(
    filter: object,
  ): Promise<{ totpBackupCodes?: StoredBackupCode[] | null } | null>;
}

/**
 * Replace ALL of a user's codes with a fresh set. Returns the plaintext
 * codes — the caller hands them to the client once and forgets them.
 */
export async function issueBackupCodes(
  store: BackupCodeStore,
  userId: ObjectId,
  pepper: string,
  now = new Date(),
): Promise<string[]> {
  const codes = generateBackupCodes();
  await store.updateOne(
    { _id: userId },
    {
      $set: {
        totpBackupCodes: toStoredBackupCodes(codes, pepper),
        totpBackupCodesGeneratedAt: now,
        updatedAt: now,
      },
    },
  );
  return codes;
}

/**
 * Atomically consume one backup code. Returns the number of codes left
 * after consumption, or `null` when the code is malformed, unknown, or
 * already used.
 *
 * The filter only matches while the element's `usedAt` is still null
 * and the positional `$` update stamps that very element — Mongo's
 * single-document atomicity means a concurrent second request finds no
 * matching element and gets `modifiedCount: 0`.
 */
export async function consumeBackupCode(
  store: BackupCodeStore,
  userId: ObjectId,
  input: string,
  pepper: string,
  now = new Date(),
): Promise<number | null> {
  const normalized = normalizeBackupCode(input);
  if (!normalized) return null;
  const hash = hashBackupCode(normalized, pepper);
  const res = await store.updateOne(
    { _id: userId, totpBackupCodes: { $elemMatch: { hash, usedAt: null } } },
    { $set: { "totpBackupCodes.$.usedAt": now, updatedAt: now } },
  );
  if (res.modifiedCount !== 1) return null;
  const after = await store.findOne({ _id: userId });
  return countRemainingBackupCodes(after?.totpBackupCodes);
}

/** `$set` fragment that wipes backup codes — used by every 2FA reset path. */
export const CLEAR_BACKUP_CODES = {
  totpBackupCodes: null,
  totpBackupCodesGeneratedAt: null,
} as const;
