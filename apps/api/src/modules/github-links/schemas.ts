/**
 * Request schemas for /api/v1/github-links. Strict everywhere: a stray key
 * is a 400, never silently dropped.
 *
 * `repo` is the only free-form string that ever reaches a GitHub URL, so
 * it is validated here with the same grammar as the shared `repo_slug`
 * param kind (exactly two segments of [A-Za-z0-9._-], no `..`), and
 * stored lower-cased so one repository has one spelling in github_links.
 */

import { z } from "zod";

export const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
export const LINK_ID_RE = /^[0-9a-f]{24}$/i;
export const MAX_PERIOD_INDEXES = 60;
export const MAX_MANIFEST_GOALS = 50;

/** "owner/name", GitHub-only. Null when the string is not a valid slug. */
export function normalizeRepo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length < 3 || s.length > 120) return null;
  if (!REPO_RE.test(s)) return null;
  if (s.includes("..")) return null;
  const [owner, name] = s.split("/");
  if (!owner || !name || owner === "." || name === ".") return null;
  return s.toLowerCase();
}

export const repoSchema = z
  .string()
  .transform((s, ctx) => {
    const repo = normalizeRepo(s);
    if (!repo) {
      ctx.addIssue({
        code: "custom",
        message: "Repository must be owner/name.",
      });
      return z.NEVER;
    }
    return repo;
  });

const goalIdSchema = z.string().min(1).max(200);

export const publishSchema = z
  .object({
    goalId: goalIdSchema,
    repo: repoSchema,
    periodIndexes: z
      .array(z.number().int().min(0).max(999))
      .max(MAX_PERIOD_INDEXES)
      .optional(),
  })
  .strict();

export const syncSchema = z.object({ goalId: goalIdSchema }).strict();

export const listQuerySchema = z.object({ goalId: goalIdSchema });

/** `goalId` optional: omitted → every live link of the user (capped). */
export const optionalGoalQuerySchema = z.object({ goalId: goalIdSchema.optional() });

/** POST /:linkId/comments — the server composes the text from `sourceId`. */
export const commentPostSchema = z
  .object({
    kind: z.enum(["manager_note", "tier_verdict"]),
    sourceId: z.string().regex(/^[0-9a-f]{24}$/i, "Not a source id.").transform((s) => s.toLowerCase()),
  })
  .strict();

export const manifestsQuerySchema = z.object({
  goalIds: z
    .string()
    .min(1)
    .max(MAX_MANIFEST_GOALS * 201)
    .transform((s, ctx) => {
      const ids = [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];
      if (ids.length === 0 || ids.length > MAX_MANIFEST_GOALS) {
        ctx.addIssue({
          code: "custom",
          message: `goalIds must name 1-${MAX_MANIFEST_GOALS} goals.`,
        });
        return z.NEVER;
      }
      if (ids.some((id) => id.length > 200)) {
        ctx.addIssue({ code: "custom", message: "A goal id is too long." });
        return z.NEVER;
      }
      return ids;
    }),
});

export const linkIdSchema = z.string().regex(LINK_ID_RE, "Not a link id.");
