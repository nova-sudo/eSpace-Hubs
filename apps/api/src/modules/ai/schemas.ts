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

// ─── compose a custom (COMPOSED) widget from a text description ───────
//
// The "describe your own tracker" escape hatch: the user types, in plain
// English, how they want to track a goal, and the model designs a COMPOSED
// spec (fields + optional cadence + tiers). The handler validates the model
// output through the shared spec builder, so the result is always renderable
// and gradeable.
export const composeWidgetSchema = z.object({
  goalId: z.string().min(1).max(200),
  goalTitle: z.string().max(500).default(""),
  description: z.string().min(3).max(2_000),
  // Text lifted out of a file the user attached, via /compose-widget/extract.
  //
  // Deliberately NOT folded into `description`, and `description`'s 2k cap
  // deliberately not raised: the two mean different things. `description` is
  // what the user themselves asked for — short, authoritative, worth its
  // tight bound. `attachment.text` is bulk source material they're pointing
  // at, which needs a far larger budget but carries less intent per token.
  // Keeping them apart is what lets the prompt (and later, telemetry) tell
  // "what the user typed" from "what came out of their file".
  //
  // The 20k cap mirrors MAX_EXTRACTED_CHARS in ./extract/index.ts — the
  // extractor is the authority, this is the boundary check on a payload the
  // client could have edited. The handler re-truncates on top of it (W8):
  // a valid-per-schema 20k blob is still re-clamped before it hits a prompt.
  attachment: z
    .object({
      text: z.string().min(1).max(20_000),
      // Display metadata only — never used to build a path server-side.
      sourceFilename: z.string().max(300).optional(),
      sourceType: z.enum(["pdf", "docx", "xlsx", "xls", "csv"]).optional(),
    })
    .optional(),
  provider,
});
export type ComposeWidgetInput = z.infer<typeof composeWidgetSchema>;

/**
 * Non-file fields of the multipart POST /compose-widget/extract body.
 * multer hands text parts through as strings on `req.body`; the file
 * itself is validated by the extractor (magic bytes), not by zod.
 * `goalId` is log/audit context — nothing is persisted against it.
 */
export const extractAttachmentSchema = z.object({
  goalId: z.string().min(1).max(200),
});
export type ExtractAttachmentInput = z.infer<typeof extractAttachmentSchema>;
