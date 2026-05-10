/**
 * Envelope encryption for small at-rest secrets — TOTP secrets in
 * M2.3c, integration tokens in M6.
 *
 * Algorithm: AES-256-GCM
 *   - 32-byte key derived from a shared master via SHA-256 (the env
 *     var INTEGRATION_TOKEN_KEY is human-readable; SHA-256 normalises
 *     it to a 256-bit key without imposing a hex format on operators)
 *   - Random 12-byte IV per record
 *   - 16-byte authentication tag bound to the payload
 *
 * Wire format (versioned for forward-compat):
 *   v1.<iv-base64url>.<tag-base64url>.<ciphertext-base64url>
 *
 * Why versioned: M6 will rotate to KMS-managed envelope encryption
 * with a per-record DEK. When that ships, decrypt() will dispatch on
 * the prefix — old `v1.*` values stay readable, new writes get `v2.*`.
 *
 * Why not pin to fixed key length / hex: operators set
 * INTEGRATION_TOKEN_KEY in a .env file or secret manager. Asking them
 * to format it correctly is a recipe for outages. We hash whatever
 * they give us and document the requirement (≥ 16 chars) in env
 * validation.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { env } from "../config/env.js";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function deriveKey(masterKey: string): Buffer {
  // SHA-256 over the master key bytes. 32-byte output for AES-256.
  return createHash("sha256").update(masterKey, "utf8").digest();
}

/** base64url without padding — same convention as token IDs. */
function b64u(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function b64uDecode(s: string): Buffer {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = (s.replaceAll("-", "+").replaceAll("_", "/")) + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}

/** Encrypt a UTF-8 plaintext into the versioned envelope format. */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey(env.INTEGRATION_TOKEN_KEY);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64u(iv), b64u(tag), b64u(ct)].join(".");
}

/**
 * Decrypt an envelope back into UTF-8 plaintext. Throws on tamper,
 * version mismatch, or shape error — callers should treat any throw
 * as "secret unusable" and prompt the user to re-enrol.
 */
export function decryptSecret(envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4) {
    throw new Error("crypto-secret: malformed envelope");
  }
  const [version, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  if (version !== VERSION) {
    throw new Error(`crypto-secret: unsupported envelope version: ${version}`);
  }
  const key = deriveKey(env.INTEGRATION_TOKEN_KEY);
  const iv = b64uDecode(ivB64);
  const tag = b64uDecode(tagB64);
  const ct = b64uDecode(ctB64);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}
