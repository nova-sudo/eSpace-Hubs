/**
 * Password hashing — argon2id, the modern recommendation.
 *
 * Why argon2id (not bcrypt, scrypt, PBKDF2):
 *   - argon2 is the 2015 Password Hashing Competition winner.
 *   - id variant resists both side-channel and time-memory attacks.
 *   - Memory cost is tunable independently of CPU cost — the right
 *     defence against GPU/ASIC-accelerated cracking.
 *
 * Why @node-rs/argon2:
 *   - Pure-Rust implementation via NAPI-RS, prebuilt for win/mac/linux.
 *   - Zero compile dependencies (no node-gyp, no python).
 *   - Faster than the JS-only alternatives at the same cost factor.
 *
 * Cost parameters (OWASP 2023 minimum, slightly above):
 *   - memoryCost: 19 MiB
 *   - timeCost: 2 iterations
 *   - parallelism: 1 (single-threaded; we want predictable latency
 *     regardless of host CPU count)
 *
 * Recalibrate every 12 months: pick parameters that take ~250-500ms
 * on the production hardware. `verify()` accepts any prior hash —
 * upgrades happen transparently via `needsRehash()` on next login.
 */

import { hash as a2hash, verify as a2verify, type Options } from "@node-rs/argon2";

// `algorithm` defaults to Argon2id in @node-rs/argon2, so we can omit
// it. Importing the `Algorithm` const enum would clash with our
// isolatedModules tsconfig setting.
const HASH_OPTIONS: Options = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/** Hash a plaintext password. Returns a self-describing PHC string. */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("hashPassword: plain must be a non-empty string");
  }
  return a2hash(plain, HASH_OPTIONS);
}

/**
 * Verify a plaintext against a stored hash. Returns false on mismatch
 * AND on any decode error — never leaks "is this a valid hash" to the
 * caller (which would help an attacker tell forged from real hashes).
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (typeof plain !== "string" || typeof hash !== "string") return false;
  try {
    return await a2verify(hash, plain);
  } catch {
    return false;
  }
}
