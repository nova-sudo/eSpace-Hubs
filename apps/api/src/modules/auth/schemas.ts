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
