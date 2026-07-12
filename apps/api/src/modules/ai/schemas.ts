/**
 * Zod schemas for /api/v1/ai/* request bodies.
 *
 * Validation runs at the controller boundary; the caller delivers a
 * fully-typed payload to the actual handler logic. Keep these tight —
 * the upstream provider charges per token, so we don't want to forward
 * malformed garbage that just becomes 400s on their end.
 */

import { z } from "zod";

const messageRole = z.enum(["user", "assistant"]);

const message = z.object({
  role: messageRole,
  content: z.string().min(1).max(40_000),
});

/** Optional provider override. The provider registry validates the id
 *  itself; here we just bound the string. */
const provider = z.string().min(2).max(40).optional();

export const chatSchema = z.object({
  messages: z.array(message).min(1).max(100),
  provider,
});
export type ChatInput = z.infer<typeof chatSchema>;

const prComment = z.object({
  user: z.string().max(200).optional(),
  body: z.string().max(20_000).optional(),
  // The grader treats these as opaque labels; keep the validator
  // permissive so future kinds don't break the schema.
  kind: z.string().max(40).optional(),
});

const prInput = z.object({
  // Allow either a numeric PR id or a string id (for cross-provider
  // identifiers that contain hyphens).
  id: z.union([z.number(), z.string().min(1).max(200)]),
  title: z.string().max(500).default(""),
  body: z.string().max(40_000).default(""),
  comments: z.array(prComment).max(500).default([]),
});

export const gradePrSchema = z.object({
  pr: prInput,
  rubric: z.array(z.string().min(1).max(500)).min(1).max(50),
  provider,
});
export type GradePrInput = z.infer<typeof gradePrSchema>;

// ─── goal achievement-tier grading ───────────────────────────────────

const tierCriterion = z.string().max(600).nullable().optional();

/**
 * Score which achievement tier a developer is at for one goal. The four
 * tier criteria come from the goal spec (classifier-distilled); the
 * `currentData` is a compact, caller-assembled summary of the goal's
 * live metrics / readings the model compares against the criteria.
 */
export const gradeGoalTierSchema = z.object({
  goalTitle: z.string().max(500).default(""),
  tiers: z.object({
    notAchieved: tierCriterion,
    achieved: tierCriterion,
    overAchieved: tierCriterion,
    roleModel: tierCriterion,
  }),
  currentData: z.string().max(8_000).default(""),
  provider,
  // Durable-cache coordinates (optional for back-compat with older clients):
  // goalId + a client-computed hash of the graded inputs. When both are
  // present the handler returns a persisted verdict for a matching hash
  // instead of re-calling the model, and persists fresh grades under them.
  goalId: z.string().min(1).max(200).optional(),
  tierHash: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  // Bypass the server cache (the "re-analyze" affordance).
  force: z.boolean().optional(),
});
export type GradeGoalTierInput = z.infer<typeof gradeGoalTierSchema>;
