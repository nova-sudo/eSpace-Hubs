/**
 * Request shapes for /api/v1/assigned-goals. The `spec` itself is checked by
 * the shared `validateSpec` plus the v1 rules in `checkAssignableSpec`
 * (controller) — zod only guards the envelope.
 */

import { z } from "zod";
import { ASSIGNEES_MAX, VIEWERS_MAX } from "../../lib/assigned-goals.js";

const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/i, "Invalid user id.");

export const DEFAULT_TIME_ZONE = "Africa/Cairo";

/** An IANA zone the runtime actually knows. */
const timeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone.");

export const createAssignedGoalSchema = z.object({
  title: z.string().trim().min(1).max(300),
  code: z.string().trim().max(200).default(""),
  description: z.string().max(4000).default(""),
  spec: z.record(z.string(), z.unknown()),
  assigneeIds: z.array(objectIdHex).min(1).max(ASSIGNEES_MAX),
  viewerIds: z.array(objectIdHex).max(VIEWERS_MAX).default([]),
  graceHours: z.number().min(0).max(720).default(0),
  timeZone: timeZone.default(DEFAULT_TIME_ZONE),
});

export const patchAssignedGoalSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    code: z.string().trim().max(200),
    description: z.string().max(4000),
    spec: z.record(z.string(), z.unknown()),
    assigneeIds: z.array(objectIdHex).min(1).max(ASSIGNEES_MAX),
    viewerIds: z.array(objectIdHex).max(VIEWERS_MAX),
    graceHours: z.number().min(0).max(720),
    timeZone,
    /**
     * Required to change the schedule (cadence / dates / period count)
     * after someone has submitted: existing entries stay, but the ones that
     * no longer line up with a period drop out of the grid.
     */
    confirmReschedule: z.boolean(),
  })
  .partial();

export const verdictSchema = z.object({
  tier: z.enum(["not_achieved", "achieved", "over_achieved", "role_model"]),
  note: z.string().max(4000).default(""),
});

export const listQuerySchema = z.object({
  scope: z.enum(["created", "viewing", "assigned"]).default("created"),
  includeArchived: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export type CreateAssignedGoalInput = z.infer<typeof createAssignedGoalSchema>;
export type PatchAssignedGoalInput = z.infer<typeof patchAssignedGoalSchema>;
