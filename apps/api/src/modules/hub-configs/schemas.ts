/**
 * Zod schemas for /api/v1/hub-configs/* request bodies.
 *
 * Mirrors the HubConfig interface in db/types.ts but stops at the
 * fields a client is allowed to set. `_id`, `orgId`, `updatedBy`,
 * `updatedAt` are server-managed.
 */

import { z } from "zod";

const slotValueSchema = z
  .union([z.string().min(1).max(200), z.null()])
  .optional();

export const upsertHubConfigSchema = z.object({
  enabled: z.union([z.boolean(), z.null()]).optional(),
  label: z.union([z.string().max(200), z.null()]).optional(),
  description: z.union([z.string().max(500), z.null()]).optional(),
  allowedIntegrations: z
    .union([z.array(z.string().min(1).max(64)).max(64), z.null()])
    .optional(),
  /**
   * Partial map. Keys are page-slot ids ("dashboard", "goals", …);
   * values are either a non-empty symbolic component id (override),
   * or `null` (REMOVE the slot from the effective map).
   */
  pages: z
    .union([z.record(z.string().min(1).max(64), slotValueSchema), z.null()])
    .optional(),
  departments: z
    .union([z.array(z.string().min(1).max(200)).max(256), z.null()])
    .optional(),
});

export type UpsertHubConfigInput = z.infer<typeof upsertHubConfigSchema>;
