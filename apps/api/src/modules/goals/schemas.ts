/**
 * Zod schemas for /api/v1/goals/* request bodies.
 *
 * The validator in ../../db/schemas/goals.schema.ts is a Mongo
 * backstop — these are the route-layer guards that shape what
 * controllers receive. Stricter than the DB validator on inner L1/L2
 * fields because we want bad shapes rejected with field-level errors,
 * not "Document failed validation" Mongo opacity.
 */

import { z } from "zod";

const isoDate = z
  .string()
  .max(20)
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .or(z.literal(""));

const priority = z.enum(["", "low", "medium", "high"]);
const stableId = z.string().min(1).max(200);

const l2Schema = z.object({
  id: stableId,
  code: z.string().max(200).default(""),
  title: z.string().max(1000).default(""),
  description: z.string().max(8_000).default(""),
  rubric: z.string().max(8_000).default(""),
  weightage: z.number().min(0).max(100).default(0),
  priority: priority.default(""),
  startDate: isoDate.default(""),
  dueDate: isoDate.default(""),
  category: z.string().max(200).default(""),
});

const l1Schema = z.object({
  id: stableId,
  code: z.string().max(200).default(""),
  title: z.string().max(1000).default(""),
  description: z.string().max(8_000).default(""),
  rubric: z.string().max(8_000).default(""),
  weightage: z.number().min(0).max(100).default(0),
  category: z.string().max(200).default(""),
  l2s: z.array(l2Schema).max(200).default([]),
});

export const goalsUpsertSchema = z.object({
  l1s: z.array(l1Schema).max(200),
});
export type GoalsUpsertInput = z.infer<typeof goalsUpsertSchema>;
