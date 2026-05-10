/**
 * Zod schemas for /api/v1/snapshots/* request bodies.
 *
 * The Mongo $jsonSchema in db/schemas/snapshots.schema.ts is a
 * defensive backstop. Real validation happens here at the route
 * boundary so callers see field-level errors, not "Document failed
 * validation".
 */

import { z } from "zod";

// Sun-anchored week label, "W16" (legacy) or "W16-2026" (preferred).
const week = z
  .string()
  .min(2)
  .max(32)
  .regex(/^W[0-9]{1,2}(-[0-9]{4})?$/, "expected W## or W##-YYYY");

const targetSchema = z.object({
  op: z.string().min(1).max(8),
  value: z.number(),
});

const goalReadingSchema = z.object({
  cadence: z.string().min(1).max(40),
  cadenceWindow: z.string().min(1).max(64),
  weekContribution: z.number().nullable(),
  cumulative: z.number().nullable(),
  target: targetSchema.nullable(),
  windowMet: z.boolean().nullable(),
  onPace: z.boolean().nullable(),
});

export const upsertSnapshotSchema = z.object({
  week,
  capturedAt: z.string().datetime({ offset: true }).optional(),
  capturedBy: z.enum(["auto", "manual"]),
  merged: z.number().nonnegative().default(0),
  reviews: z.number().nonnegative().default(0),
  turnaround: z.number().nonnegative().default(0),
  // Linkage is a percentage — bound it.
  linkage: z.number().min(0).max(100).default(0),
  rounds: z.number().nonnegative().default(0),
  note: z.string().max(8_000).default(""),
  goalReadings: z.record(z.string().min(1).max(200), goalReadingSchema).default({}),
  partial: z.boolean().default(false),
  gaps: z.array(z.string().max(64)).max(20).default([]),
});
export type UpsertSnapshotInput = z.infer<typeof upsertSnapshotSchema>;

export const patchSnapshotSchema = z.object({
  note: z.string().max(8_000).optional(),
  goalReadings: z
    .record(z.string().min(1).max(200), goalReadingSchema)
    .optional(),
});
export type PatchSnapshotInput = z.infer<typeof patchSnapshotSchema>;

export const listQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(250).default(60),
});
export type ListSnapshotsInput = z.infer<typeof listQuerySchema>;
