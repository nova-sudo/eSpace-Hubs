/**
 * Zod schemas for auth-route inputs. Validation happens at the route
 * boundary — controllers receive already-parsed, fully-typed payloads.
 *
 * Schemas mirror the route they guard. Don't combine them; "one schema
 * per request shape" keeps error messages targeted.
 */

import { z } from "zod";

const email = z
  .string()
  .min(3)
  .max(320)
  .toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "must be a valid email");

const password = z
  .string()
  .min(8, "password must be at least 8 characters")
  .max(256, "password must be at most 256 characters");

export const loginSchema = z.object({
  email,
  password,
});
export type LoginInput = z.infer<typeof loginSchema>;

const role = z.enum(["admin", "dev", "qa", "manager", "hr", "po", "member"]);
const displayName = z.string().min(1).max(200);

/**
 * Invite payload.
 *   - `role` is the legacy single-role field (still required for
 *     wire compat with older admin tooling)
 *   - `roles` is the new multi-role array; optional, falls back to
 *     [role] when missing
 *
 * The handler writes both: `role = roles[0]` and `roles` verbatim.
 * When the legacy `role` field is removed in a follow-up, `roles`
 * becomes the only required field.
 */
export const inviteSchema = z
  .object({
    email,
    role,
    roles: z.array(role).min(1).max(8).optional(),
    displayName,
  })
  .transform((input) => ({
    ...input,
    roles: input.roles ?? [input.role],
  }));
export type InviteInput = z.infer<typeof inviteSchema>;

// Token shape: 32-byte random base64url (43 chars). Liberal on length
// to allow URL escaping, but the chars must be base64url-safe.
const oneTimeToken = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, "malformed token");

export const acceptInviteSchema = z.object({
  token: oneTimeToken,
  password,
  // Optional displayName override — admin's invite display might be a
  // placeholder ("Yara R."), the user can refine on accept.
  displayName: displayName.optional(),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const passwordResetRequestSchema = z.object({ email });
export type PasswordResetRequestInput = z.infer<
  typeof passwordResetRequestSchema
>;

export const passwordResetSchema = z.object({
  token: oneTimeToken,
  password,
});
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

/**
 * Self-service profile patch. Scoped to fields a user can edit
 * about THEMSELVES — not the admin-managed dimensions (role,
 * status, hub access) that flow through /admin/users/:id.
 *
 * Email is intentionally NOT in this list. Changing email is the
 * login-key change; it'd need a confirmation-email round-trip
 * AND invalidating existing sessions. Out of scope here — defer
 * with the rest of the email-related auth work (alongside
 * /forgot-email or similar).
 *
 * Every field is optional. Empty body parses fine but the
 * controller treats it as a no-op (no audit row, no DB write).
 */
export const profileUpdateSchema = z.object({
  displayName: displayName.optional(),
  employeeId: z.string().min(1).max(64).nullable().optional(),
  department: z.string().min(1).max(200).nullable().optional(),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

// 6-digit TOTP code. Strict — the controller never logs/echoes a
// malformed code, so any leniency would just produce more 401s.
const totpCode = z.string().regex(/^\d{6}$/, "code must be 6 digits");

export const totpVerifySchema = z.object({ code: totpCode });
export type TotpVerifyInput = z.infer<typeof totpVerifySchema>;

export const totpDisableSchema = z.object({ code: totpCode });
export type TotpDisableInput = z.infer<typeof totpDisableSchema>;

/**
 * Public-facing user shape. Strips passwordHash, totpSecret, and any
 * field a client has no business knowing. The login + me endpoints
 * return this — never the raw User doc.
 */
export interface PublicUser {
  id: string;
  orgId: string;
  email: string;
  /**
   * Primary role — first element of `roles`. Kept for backward-compat
   * with UI code that switches on a single role; new code should
   * read `roles` and/or `capabilities` instead.
   */
  role: string;
  /**
   * All roles the user holds. The orchestrator computes which hubs
   * they can access by unioning capabilities from this list.
   */
  roles: string[];
  /**
   * Capability ids granted by the union of `roles`. Convenience —
   * the frontend can re-derive from `roles` via
   * `@espace-devhub/shared/capabilities`, but shipping it saves a
   * round-trip and keeps gating authoritative (server-derived).
   */
  capabilities: string[];
  status: string;
  displayName: string;
  totpEnrolled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /**
   * Onboarding state — null until the user submits the M-OB form.
   * Frontend AuthGuard reads this to decide whether to trap the
   * user at /onboarding.
   */
  onboardingCompletedAt: string | null;
  /** User-entered employee identifier; null pre-onboarding. */
  employeeId: string | null;
  /** Department label picked during onboarding; drives hub assignment. */
  department: string | null;
  /** Convenience for the frontend — the user's primary hub id, if set. */
  primaryHub: string | null;
}
