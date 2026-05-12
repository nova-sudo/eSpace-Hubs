/**
 * Zod schemas for /api/v1/admin/* request bodies + query strings.
 *
 * Scope: only what the admin UIs actually need today — users list +
 * one PATCH endpoint over the small set of admin-editable user
 * fields, and an audit-log list with simple filters.
 *
 * Server-managed fields (orgId, _id, createdAt, passwordHash, totp*,
 * lastLoginAt, etc.) are NEVER accepted from the client. Anything not
 * in the schema is dropped via Zod's default-strict parsing.
 */

import { z } from "zod";
import { ALL_USER_ROLES, ALL_USER_STATUSES } from "../../db/types.js";

const roleEnum = z.enum(ALL_USER_ROLES as readonly [string, ...string[]]);
const statusEnum = z.enum(
  ALL_USER_STATUSES as readonly [string, ...string[]],
);

// ─── PATCH /api/v1/admin/users/:id ───────────────────────────────────

/**
 * Every field is optional — clients send only what they're changing.
 * Empty body parses fine but the controller treats it as a no-op (no
 * audit row, no DB write).
 *
 * Notable constraints:
 *   - `roles` cannot be empty when present — at minimum a user needs
 *     one role for hub access to resolve. Use the registry's role
 *     baseline (e.g. ["dev"]) for an effectively-no-special-roles user.
 *   - `allowedHubs` allows an empty array, but the controller refuses
 *     to write one — locking a user out of every hub is almost
 *     certainly a mistake. Pass null/omit to fall back to the
 *     role-derived default.
 *   - `primaryHub` must appear in `allowedHubs` when both are sent.
 *     Cross-field validation lives in the controller because the
 *     server may also be computing allowedHubs from the role change.
 */
export const updateUserSchema = z.object({
  roles: z.array(roleEnum).min(1).max(8).optional(),
  status: statusEnum.optional(),
  allowedHubs: z.array(z.string().min(1).max(64)).max(32).optional(),
  primaryHub: z.string().min(1).max(64).nullable().optional(),
  displayName: z.string().min(1).max(200).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// ─── GET /api/v1/admin/audit ─────────────────────────────────────────

/**
 * Filter shape. All optional; query-string-coerced before parse.
 *
 *   action     — exact match on the dot-namespaced verb
 *                ("user.invite" / "hub_config.upsert" / …). Future:
 *                accept a comma-separated list.
 *   actorUserId — hex ObjectId; filters to a single actor
 *   targetType  — exact match ("user" / "hub" / "integration" / …)
 *   targetId    — exact match; pairs with targetType when narrowing
 *                to one object
 *   since       — ISO datetime; entries with ts >= since
 *   until       — ISO datetime; entries with ts < until
 *   limit       — 1..200, default 50. Hard-capped server-side to keep
 *                response sizes predictable; pagination uses `until`
 *                with the oldest row's `ts` from the previous page.
 */
export const listAuditQuerySchema = z.object({
  action: z.string().min(3).max(100).optional(),
  actorUserId: z
    .string()
    .regex(/^[0-9a-f]{24}$/i, "actorUserId must be a hex ObjectId")
    .optional(),
  targetType: z.string().min(1).max(64).optional(),
  targetId: z.string().min(1).max(128).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
