/**
 * Zod schemas for the /api/v1/companion/* routes.
 *
 * The companion app is the desktop process running on a Crealogix
 * dev's laptop. To authenticate its API calls (Authorization: Bearer
 * <token>) we run a one-time pairing handshake:
 *
 *   1. Companion → POST /pair/start            { deviceName }
 *      Server → { code, expiresAt, approvalUrl }
 *
 *   2. User opens approvalUrl in their already-logged-in browser,
 *      sees the device name + IP, clicks Approve.
 *      Browser → POST /pair/approve            { code }
 *      Server  → { ok: true }
 *
 *   3. Companion polls GET /pair/poll?code=... — when status flips
 *      to "approved" the server returns the bearer token ONCE in
 *      plaintext, then marks the pairing consumed.
 *
 * The pairing code (`_id` of the companion_pairings row) is what the
 * companion polls with. Codes are short (10 chars, base32-ish) so the
 * approval URL stays readable.
 */

import { z } from "zod";

/** Pairing-code format: 10 base32 alphanumerics (0-9 + A-Z minus 0/O/1/I). */
const pairingCode = z
  .string()
  .min(8)
  .max(32)
  .regex(/^[A-Za-z0-9-]+$/, "malformed pairing code");

export const pairStartSchema = z.object({
  /**
   * Human-readable label the user sees in the approval dialog AND
   * later on the Devices list. Defaults to "Companion" if the caller
   * doesn't supply one; not optional in the schema so the route
   * always has a non-empty string.
   */
  deviceName: z.string().min(1).max(200).default("Companion"),
});
export type PairStartInput = z.infer<typeof pairStartSchema>;

export const pairPollQuerySchema = z.object({
  code: pairingCode,
});
export type PairPollInput = z.infer<typeof pairPollQuerySchema>;

export const pairApproveSchema = z.object({
  code: pairingCode,
});
export type PairApproveInput = z.infer<typeof pairApproveSchema>;
