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

const role = z.enum(["admin", "manager", "member", "hr", "qa", "po"]);
const displayName = z.string().min(1).max(200);

export const inviteSchema = z.object({
  email,
  role,
  displayName,
});
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
  role: string;
  status: string;
  displayName: string;
  totpEnrolled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}
