/**
 * TOTP — RFC 6238 time-based one-time passwords. Wraps `otplib` so the
 * call sites stay clean and the library is swappable later.
 *
 * Configuration:
 *   - 6 digits (industry standard, what Google Authenticator / Authy /
 *     1Password expect)
 *   - 30-second period
 *   - SHA-1 (the spec's required default — every authenticator app
 *     supports it; SHA-256 / SHA-512 still have spotty client coverage)
 *   - Verification window of ±1 period (~30s grace) for clock drift
 *
 * Secrets are base32, the encoding every TOTP app speaks. We
 * envelope-encrypt them at rest via crypto-secret.ts before writing
 * to Mongo.
 */

import { authenticator } from "otplib";

// Configure once at module load. otplib's authenticator is a shared
// singleton; this is the canonical place to set its options.
authenticator.options = {
  digits: 6,
  step: 30,
  // 1 = accept the previous and next periods in addition to the
  // current one. Mostly to absorb client clock drift — at most ±30s.
  window: 1,
};

/**
 * Application name shown in authenticator apps next to the account.
 * Keep consistent — changing it after enrolment makes a duplicate
 * entry appear in the user's app on rotate.
 */
const ISSUER = "eSpace Dev Hub";

/** Generate a fresh base32 TOTP secret. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/**
 * Verify a 6-digit code against a base32 secret. Returns false on any
 * malformed input or mismatch — never throws.
 */
export function verifyTotpCode(code: string, secret: string): boolean {
  if (typeof code !== "string" || typeof secret !== "string") return false;
  if (!/^\d{6}$/.test(code)) return false;
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

/**
 * Build the otpauth:// provisioning URI shown to the user as a QR
 * code during enrolment. The frontend can render this URI directly
 * with any QR-code library; the secret never appears in the URL the
 * browser navigates to (the URI is a *payload* for the QR, not a
 * navigation target).
 *
 * Format: otpauth://totp/<issuer>:<account>?secret=<base32>&issuer=<issuer>...
 */
export function buildProvisioningUri(
  accountEmail: string,
  secret: string,
): string {
  return authenticator.keyuri(accountEmail, ISSUER, secret);
}
