/**
 * /api/v1/ai/* controllers — chat + grade-pr.
 *
 * Both handlers are stateless proxies to the active OpenAI-compatible
 * provider. The session-bearing user is logged for ops visibility (in
 * the audit + pino), but the model never sees auth context — only the
 * conversation / PR data the caller submitted.
 *
 * Streaming endpoints (classify-goals + the wider analyst classifier)
 * land in M3.2 — that's a 600-line subsystem move out of
 * apps/web/src/features/analyst/ai/, not a route change.
 */

import type { NextFunction, Request, Response } from "express";
import { logger } from "../../lib/logger.js";
import {
  fetchWithRateLimitRetry,
  isRateLimited,
  retryAfterMsFromHeaders,
} from "../../lib/rate-limit.js";
import { HttpError } from "../../middleware/error-handler.js";
import { getGoalTierVerdictsCollection } from "../../db/collections.js";
import type { GoalTierVerdictBody } from "../../db/types.js";
import { resolveRequestedId, selectProvider } from "./provider.js";
import { anthropicComplete, isAnthropicId } from "./anthropic.js";
import {
  chatSchema,
  gradePrSchema,
  gradeGoalTierSchema,
  composeWidgetSchema,
} from "./schemas.js";
import {
  buildSpec,
  normalizeCadence,
  COMPOSED_FIELD_KINDS,
} from "@espace-devhub/shared/goal-specs";

/** Parse a model's JSON reply, tolerating stray prose / markdown fences
 *  (the OpenAI path uses json_object mode; Claude relies on the prompt). */
function parseJsonLoose(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const first = content.indexOf("{");
    const last = content.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(content.slice(first, last + 1));
    }
    throw new Error("no JSON object in response");
  }
}

const COMMENT_CHAR_LIMIT = 12_000;
const PR_BODY_CHAR_LIMIT = 4_000;

const CHAT_SYSTEM_PROMPT = [
  "You are the eSpace Dev Hub assistant — a calm, concise helper embedded",
  "in a personal engineering-performance dashboard. The dashboard pulls",
  "Jira, GitLab and GitHub data for one user, and is used to prep for",
  "performance reviews and 1:1s.",
  "",
  "Voice: measured, editorial, no hype. Short sentences. Prefer bullet",
  "lists for 3+ items. Don't add headings unless asked. Default to the",
  "user's terminology (PR / MR / ticket / review round / linkage).",
  "",
  "You are a chat assistant, not a data tool — you can't read the user's",
  "live Jira or GitLab data unless they paste it in. If they ask about",
  "their numbers, ask them to paste the snippet or point at the tile.",
].join("\n");

const GRADER_SYSTEM_PROMPT = [
  "You grade a single pull request against a user-defined rubric of quality",
  "criteria. The user is preparing performance-review evidence, so your",
  "grading must be fair, specific, and defensible.",
  "",
  "INPUT you receive:",
  "  - The PR title and body",
  "  - Every conversation + review comment on the PR",
  "  - A rubric: an array of short criterion strings",
  "",
  "TASK:",
  "  For EACH criterion, decide pass/fail based strictly on evidence in the",
  "  PR body or comments. Do not speculate beyond what's written.",
  "",
  "DECISION RULES:",
  "  - A criterion PASSES if nothing in the PR body or comments indicates a",
  "    violation of it.",
  "  - A criterion FAILS if a reviewer raised a concern that maps to it and",
  "    the concern was NOT resolved (no follow-up commit, no 'fixed', no",
  "    'addressed' reply from the author).",
  "  - The overall PR `pass` is TRUE iff all criteria pass.",
  "",
  "OUTPUT:",
  "  Return ONE JSON object, no prose, no markdown:",
  "  {",
  '    "pass":       <boolean>,',
  '    "reasoning":  <one sentence summary — what tipped the decision>,',
  '    "violations": [<one short string per failing criterion>]',
  "  }",
  "",
  "  `violations` must be empty when `pass` is true.",
  "  Keep each violation string under 140 chars.",
].join("\n");

interface PrComment {
  user?: string;
  body?: string;
  kind?: string;
}

function buildGraderUserPrompt(
  pr: { title: string; body: string; comments: PrComment[] },
  rubric: string[],
): string {
  const commentsTrimmed = pr.comments
    .map((c) => `- [${c.kind ?? "comment"}] ${c.user ?? "unknown"}: ${c.body ?? ""}`)
    .join("\n")
    .slice(0, COMMENT_CHAR_LIMIT);

  return [
    "Rubric (ALL criteria must pass):",
    ...rubric.map((r, i) => `  ${i + 1}. ${r}`),
    "",
    `PR title: ${pr.title}`,
    `PR body:`,
    pr.body.slice(0, PR_BODY_CHAR_LIMIT),
    "",
    "Comments:",
    commentsTrimmed || "(no comments)",
    "",
    "Grade this PR. Respond with a single JSON object.",
  ].join("\n");
}

/**
 * Shared upstream-call wrapper. Maps fetch failures to HttpError so the
 * error middleware shapes them consistently. Never leaks the API key
 * (logger redacts authorization, but we keep an extra safety: never
 * spread headers into anything we log).
 */
async function callProvider(
  provider: ReturnType<typeof selectProvider>,
  body: object,
): Promise<{ data: unknown; raw: string }> {
  if (!provider.apiKey) {
    throw new HttpError(
      500,
      "ai_provider_unconfigured",
      `${provider.label} has no API key. Set ${provider.keyEnv} in apps/api/.env.local and restart.`,
    );
  }

  // NOTE: deliberately untyped. Annotating `upstream: Response` would
  // resolve to Express's Response (imported above), not the global
  // fetch Response. Inference picks up the right shape from `fetch()`.
  //
  // Bounded retry on rate limits: model-tier 429s tend to clear in a
  // few seconds, so we wait the upstream-indicated `Retry-After` and
  // retry within the function budget. If it's still limited after that,
  // we surface the wait time to the caller (see below) so the browser
  // can resume in the background rather than failing the batch.
  let upstream;
  try {
    upstream = await fetchWithRateLimitRetry(
      () =>
        fetch(provider.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            ...provider.extraHeaders,
          },
          body: JSON.stringify(body),
        }),
      { maxAttempts: 3, maxTotalWaitMs: 20_000 },
    );
  } catch (err) {
    throw new HttpError(
      502,
      "ai_provider_unreachable",
      `Network error reaching ${provider.label}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const raw = await upstream.text();
  if (!upstream.ok) {
    // Surface the upstream status verbatim — useful for ops debugging
    // model-tier rate limits or quota errors. On a persistent rate
    // limit, attach the retry delay so the client can back off and
    // resume the batch in the background.
    const rateLimited = isRateLimited(upstream.status, upstream.headers);
    throw new HttpError(
      upstream.status,
      rateLimited ? "ai_provider_rate_limited" : "ai_provider_error",
      `${provider.label} ${upstream.status}: ${raw.slice(0, 500)}`,
      undefined,
      rateLimited
        ? (retryAfterMsFromHeaders(upstream.headers) ?? 30_000)
        : undefined,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new HttpError(
      502,
      "ai_provider_bad_response",
      `${provider.label} returned a non-JSON envelope.`,
    );
  }
  return { data, raw };
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: unknown;
}

// ─── POST /api/v1/ai/chat ────────────────────────────────────────────

export async function chatHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = chatSchema.parse(req.body);

    // Claude (native SDK) branch — system goes in its own param, not the
    // message list.
    if (isAnthropicId(resolveRequestedId({ request: req, bodyProvider: payload.provider ?? null }))) {
      const r = await anthropicComplete({
        system: CHAT_SYSTEM_PROMPT,
        messages: payload.messages,
        maxTokens: 4096,
      });
      res.json({
        content: r.content,
        model: r.model,
        provider: "anthropic",
        usage: r.usage,
      });
      return;
    }

    const provider = selectProvider({
      request: req,
      bodyProvider: payload.provider ?? null,
    });

    const upstream = await callProvider(provider, {
      model: provider.model,
      temperature: 0.4,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        ...payload.messages,
      ],
    });

    const data = upstream.data as CompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    res.json({
      content: content.trim(),
      model: data.model,
      provider: provider.id,
      usage: data.usage,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/ai/grade-pr ────────────────────────────────────────

export async function gradePrHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = gradePrSchema.parse(req.body);
    const userPrompt = buildGraderUserPrompt(payload.pr, payload.rubric);

    let content: string;
    let modelName: string | undefined;
    let usage: unknown;
    let providerId: string;
    let providerLabel: string;

    if (isAnthropicId(resolveRequestedId({ request: req, bodyProvider: payload.provider ?? null }))) {
      const r = await anthropicComplete({
        system: GRADER_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 2048,
      });
      content = r.content;
      modelName = r.model;
      usage = r.usage;
      providerId = "anthropic";
      providerLabel = "Claude";
    } else {
      const provider = selectProvider({
        request: req,
        bodyProvider: payload.provider ?? null,
      });
      const upstream = await callProvider(provider, {
        model: provider.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: GRADER_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });
      const data = upstream.data as CompletionResponse;
      content = data.choices?.[0]?.message?.content ?? "";
      modelName = data.model;
      usage = data.usage;
      providerId = provider.id;
      providerLabel = provider.label;
    }

    let parsed: { pass?: unknown; reasoning?: unknown; violations?: unknown };
    try {
      parsed = parseJsonLoose(content) as typeof parsed;
    } catch {
      throw new HttpError(
        502,
        "ai_provider_bad_response",
        `${providerLabel} returned non-JSON content: ${content.slice(0, 200)}`,
      );
    }

    // Defensive normalisation — JSON mode is reliable but the model can
    // still return slightly off-spec shapes (e.g. `pass` as a string).
    const verdict = {
      pass: Boolean(parsed?.pass),
      reasoning:
        typeof parsed?.reasoning === "string" ? parsed.reasoning.trim() : "",
      violations: Array.isArray(parsed?.violations)
        ? (parsed.violations as unknown[])
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter(Boolean)
        : [],
    };

    logger.debug(
      {
        userId: session.userId.toHexString(),
        prId: String(payload.pr.id),
        rubricLen: payload.rubric.length,
        pass: verdict.pass,
        provider: providerId,
      },
      "[ai] graded pr",
    );

    res.json({
      verdict,
      model: modelName,
      provider: providerId,
      usage,
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/ai/grade-goal-tier ─────────────────────────────────

const GOAL_TIER_SYSTEM_PROMPT = [
  "You assess which ACHIEVEMENT TIER a developer is at for ONE performance",
  "goal, based on the goal's tier criteria and the developer's current data.",
  "",
  "INPUT:",
  "  - The goal title",
  "  - Four tier criteria: notAchieved / achieved / overAchieved / roleModel",
  "  - The developer's CURRENT DATA for the goal (metrics, counts, readings)",
  "",
  "TASK: pick the single HIGHEST tier whose criteria the current data meets.",
  "  - Tiers are cumulative: roleModel implies overAchieved implies achieved.",
  "  - Evaluate bottom-up against the data the dashboard actually tracks.",
  "  - Grade on a tier's MEASURABLE core. If the current data clearly meets",
  "    that core (e.g. the checklist/threshold/count a tier names), CREDIT the",
  "    tier — even when a side-clause is team-wide or qualitative and the data",
  "    can't confirm it. Note the unconfirmed clause in the reasoning and use",
  "    medium (or low) confidence; do NOT drop to 'not_achieved' just because a",
  "    side-clause is unverifiable from one developer's data.",
  "  - Use 'not_achieved' only when the data is genuinely absent, or when it",
  "    clearly FAILS the 'achieved' threshold (e.g. a half-complete checklist).",
  "",
  "OUTPUT: ONE JSON object, no prose, no markdown:",
  "  {",
  '    "tier":       "not_achieved" | "achieved" | "over_achieved" | "role_model",',
  '    "reasoning":  <one sentence — which criteria the data met or missed>,',
  '    "confidence": "high" | "medium" | "low"',
  "  }",
  "  Use 'low' confidence when the data is sparse or the criteria aren't",
  "  directly measurable from what's provided.",
].join("\n");

function buildTierUserPrompt(
  goalTitle: string,
  tiers: {
    notAchieved?: string | null;
    achieved?: string | null;
    overAchieved?: string | null;
    roleModel?: string | null;
  },
  currentData: string,
): string {
  const line = (label: string, v?: string | null) =>
    `  ${label}: ${v && v.trim() ? v.trim() : "(not defined)"}`;
  return [
    `Goal: ${goalTitle || "(untitled)"}`,
    "",
    "Achievement tiers:",
    line("Not achieved", tiers.notAchieved),
    line("Achieved", tiers.achieved),
    line("Over achieved", tiers.overAchieved),
    line("Role model", tiers.roleModel),
    "",
    "Developer's current data:",
    currentData && currentData.trim() ? currentData.trim() : "(no data available yet)",
    "",
    "Which tier is the developer at? Respond with a single JSON object.",
  ].join("\n");
}

const VALID_TIERS = [
  "not_achieved",
  "achieved",
  "over_achieved",
  "role_model",
];
const VALID_CONFIDENCE = ["high", "medium", "low"];

export async function gradeGoalTierHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = gradeGoalTierSchema.parse(req.body);

    // Durable cache: when the client supplies goalId + tierHash, a matching
    // persisted verdict is returned WITHOUT calling the model — grade once per
    // data state, share across the user's devices, re-grade only on change.
    const cacheable = Boolean(payload.goalId && payload.tierHash);
    const verdicts = await getGoalTierVerdictsCollection();
    if (cacheable && !payload.force) {
      const hit = await verdicts.findOne({
        orgId: session.orgId,
        userId: session.userId,
        goalId: payload.goalId,
      });
      if (hit && hit.tierHash === payload.tierHash) {
        res.json({
          verdict: hit.verdict,
          model: hit.model,
          provider: hit.provider,
          cached: true,
        });
        return;
      }
    }

    const userPrompt = buildTierUserPrompt(
      payload.goalTitle,
      payload.tiers,
      payload.currentData,
    );

    let content: string;
    let modelName: string | undefined;
    let providerId: string;
    let providerLabel: string;

    if (isAnthropicId(resolveRequestedId({ request: req, bodyProvider: payload.provider ?? null }))) {
      const r = await anthropicComplete({
        system: GOAL_TIER_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 1024,
      });
      content = r.content;
      modelName = r.model;
      providerId = "anthropic";
      providerLabel = "Claude";
    } else {
      const provider = selectProvider({
        request: req,
        bodyProvider: payload.provider ?? null,
      });
      const upstream = await callProvider(provider, {
        model: provider.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: GOAL_TIER_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });
      const data = upstream.data as CompletionResponse;
      content = data.choices?.[0]?.message?.content ?? "";
      modelName = data.model;
      providerId = provider.id;
      providerLabel = provider.label;
    }

    let parsed: { tier?: unknown; reasoning?: unknown; confidence?: unknown };
    try {
      parsed = parseJsonLoose(content) as typeof parsed;
    } catch {
      throw new HttpError(
        502,
        "ai_provider_bad_response",
        `${providerLabel} returned non-JSON content: ${content.slice(0, 200)}`,
      );
    }

    const verdict: GoalTierVerdictBody = {
      tier: (typeof parsed?.tier === "string" && VALID_TIERS.includes(parsed.tier)
        ? parsed.tier
        : "not_achieved") as GoalTierVerdictBody["tier"],
      // Clamp to the persistence validator's 4000-char bound — a model that
      // ignores "one sentence" and returns a long reasoning must not make the
      // upsert throw (which would 500 and lose an already-paid-for grade).
      reasoning:
        typeof parsed?.reasoning === "string"
          ? parsed.reasoning.trim().slice(0, 4_000)
          : "",
      confidence: (typeof parsed?.confidence === "string" &&
      VALID_CONFIDENCE.includes(parsed.confidence)
        ? parsed.confidence
        : "low") as GoalTierVerdictBody["confidence"],
    };

    // Persist the fresh verdict under (user, goal) keyed by tierHash. Upsert so
    // a data change (new hash) replaces the prior row — only the latest is kept.
    if (cacheable) {
      await verdicts.updateOne(
        {
          orgId: session.orgId,
          userId: session.userId,
          goalId: payload.goalId!,
        },
        {
          $set: {
            tierHash: payload.tierHash!,
            verdict,
            gradedAt: new Date(),
            model: modelName ?? null,
            provider: providerId ?? null,
          },
          $setOnInsert: {
            orgId: session.orgId,
            userId: session.userId,
            goalId: payload.goalId!,
          },
        },
        { upsert: true },
      );
    }

    res.json({ verdict, model: modelName, provider: providerId, cached: false });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/v1/ai/goal-tier-verdicts ───────────────────────────────
// Hydrate the client's tier-verdict cache in one round-trip: every persisted
// verdict for the user, so a fresh device / cleared cache doesn't re-grade
// goals whose data hasn't changed.
export async function listGoalTierVerdictsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const verdicts = await getGoalTierVerdictsCollection();
    const rows = await verdicts
      .find({ orgId: session.orgId, userId: session.userId })
      .toArray();
    res.json({
      verdicts: rows.map((r) => ({
        goalId: r.goalId,
        tierHash: r.tierHash,
        verdict: r.verdict,
        gradedAt: r.gradedAt,
        model: r.model,
        provider: r.provider,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/v1/ai/compose-widget ──────────────────────────────────
// The "describe your own tracker" escape hatch. Turns a user's plain-English
// description of how they want to track a goal into a COMPOSED spec (fields +
// optional cadence + tiers). Output is normalised then run through the shared
// buildSpec, so what we return is always renderable + gradeable.

const COMPOSE_WIDGET_SYSTEM_PROMPT = [
  "You design a custom TRACKER for ONE performance goal from the user's",
  "plain-English description of how THEY want to track it. The tracker is a",
  "small form the user fills in — optionally once per time period.",
  "",
  "OUTPUT: ONE JSON object, no prose, no markdown:",
  "{",
  '  "composed": {',
  '    "cadence": <one of: daily, weekly, biweekly, monthly, quarterly — or null>,',
  '    "prompt":  <one short line shown above the form>',
  "  },",
  '  "fields": [',
  "    {",
  '      "id":      <short slug, a-z0-9->,',
  `      "kind":    <one of: ${COMPOSED_FIELD_KINDS.join(", ")}>,`,
  '      "label":   <short label>,',
  '      "unit":    <optional, e.g. "chapters">,',
  '      "options": [<strings — REQUIRED when kind is "select">],',
  '      "target":  { "op": ">="|"<="|"=", "value": <number> }  (only for counter/number)',
  "    }",
  "  ],",
  '  "tiers": {',
  '    "notAchieved": <string>, "achieved": <string>,',
  '    "overAchieved": <string>, "roleModel": <string>',
  "  }",
  "}",
  "",
  "RULES:",
  "  - 1 to 6 fields. Each field is ONE thing the user logs. Prefer the",
  "    SIMPLEST set that captures their intent — don't invent extra fields.",
  '  - If the user does something "every <period>" (e.g. "5 chapters every',
  '    quarter"), set composed.cadence to that period so they get ONE record',
  "    per period. For a one-time or open-ended goal, use null.",
  "  - Field kinds: number/counter for quantities (add a `unit`, and a",
  '    `target` when they state one, e.g. "5 chapters" → number, unit',
  '    "chapters", target {op:">=", value:5}); checkbox for yes/no; scale for a',
  "    1–5 rating; select for a fixed choice set (MUST include options); text",
  "    for notes; date for a date; link for a URL / evidence.",
  "  - tiers describe what not-achieved / achieved / over-achieved / role-model",
  "    look like FOR THIS tracker, in terms of the fields (e.g. achieved =",
  '    "logged >= 5 chapters this quarter"). Keep each under ~200 chars.',
  "  - Return ONLY the JSON object.",
].join("\n");

function buildComposeUserPrompt(goalTitle: string, description: string): string {
  return [
    `Goal: ${goalTitle || "(untitled)"}`,
    "",
    "How the user wants to track it:",
    description.trim(),
    "",
    "Design the tracker. Respond with a single JSON object.",
  ].join("\n");
}

/** Last-resort fields so we always return a usable tracker even when the
 *  model's field list is unusable. The user can refine from the widget. */
const DEFAULT_COMPOSED_FIELDS = [
  { id: "progress", kind: "text", label: "What did you do this period?" },
  { id: "done", kind: "checkbox", label: "Completed as planned" },
  { id: "evidence", kind: "link", label: "Evidence / link" },
];

const COMPOSED_KIND_SET = new Set<string>(COMPOSED_FIELD_KINDS as readonly string[]);
const TARGET_OP_SET = new Set(["<=", ">=", "="]);

/**
 * Coerce the model's `fields` into clean, buildSpec-safe field objects. Unknown
 * kinds collapse to `text`, a `select` with no options downgrades to `text`,
 * ids are slugified + de-duped, and the list is capped. Returns [] when nothing
 * usable survives (caller seeds a default).
 */
function cleanComposedFields(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const ff = f as Record<string, unknown>;
    const label = typeof ff.label === "string" ? ff.label.trim() : "";
    if (!label) continue;
    let kind =
      typeof ff.kind === "string" ? ff.kind.trim().toLowerCase() : "";
    if (!COMPOSED_KIND_SET.has(kind)) kind = "text";
    let id =
      typeof ff.id === "string" && ff.id.trim()
        ? ff.id
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "")
        : "";
    if (!id) id = `f${out.length + 1}`;
    while (seen.has(id)) id = `${id}-${out.length + 1}`;
    seen.add(id);

    const field: Record<string, unknown> = { id, kind, label };
    if (typeof ff.unit === "string" && ff.unit.trim()) field.unit = ff.unit.trim();
    if (typeof ff.help === "string" && ff.help.trim()) field.help = ff.help.trim();
    if (ff.optional === true) field.optional = true;

    if (kind === "select") {
      const options = Array.isArray(ff.options)
        ? ff.options
            .map((o) => (typeof o === "string" ? o.trim() : ""))
            .filter(Boolean)
        : [];
      if (options.length === 0) field.kind = "text"; // no options → plain text
      else field.options = options;
    }
    if (
      (field.kind === "counter" || field.kind === "number") &&
      ff.target &&
      typeof ff.target === "object"
    ) {
      const t = ff.target as Record<string, unknown>;
      const op = typeof t.op === "string" ? t.op : "";
      const value = typeof t.value === "number" ? t.value : Number(t.value);
      if (TARGET_OP_SET.has(op) && Number.isFinite(value)) {
        field.target = { op, value };
      }
    }
    out.push(field);
    if (out.length >= 8) break;
  }
  return out;
}

function cleanComposedBlock(
  raw: unknown,
): { cadence?: string; prompt?: string } | null {
  const out: { cadence?: string; prompt?: string } = {};
  if (raw && typeof raw === "object") {
    const c = raw as Record<string, unknown>;
    const cadence = normalizeCadence(
      typeof c.cadence === "string" ? c.cadence : "",
    );
    if (cadence) out.cadence = cadence;
    if (typeof c.prompt === "string" && c.prompt.trim()) {
      out.prompt = c.prompt.trim();
    }
  }
  return Object.keys(out).length ? out : null;
}

function cleanTiers(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const s = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 600) : null;
  const tiers: Record<string, string> = {};
  for (const key of ["notAchieved", "achieved", "overAchieved", "roleModel"]) {
    const v = s(t[key]);
    if (v) tiers[key] = v;
  }
  return Object.keys(tiers).length ? tiers : null;
}

export async function composeWidgetHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    const payload = composeWidgetSchema.parse(req.body);
    const userPrompt = buildComposeUserPrompt(
      payload.goalTitle,
      payload.description,
    );

    let content: string;
    let modelName: string | undefined;
    let providerId: string;
    let providerLabel: string;

    if (
      isAnthropicId(
        resolveRequestedId({ request: req, bodyProvider: payload.provider ?? null }),
      )
    ) {
      const r = await anthropicComplete({
        system: COMPOSE_WIDGET_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        maxTokens: 1500,
      });
      content = r.content;
      modelName = r.model;
      providerId = "anthropic";
      providerLabel = "Claude";
    } else {
      const provider = selectProvider({
        request: req,
        bodyProvider: payload.provider ?? null,
      });
      const upstream = await callProvider(provider, {
        model: provider.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: COMPOSE_WIDGET_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });
      const data = upstream.data as CompletionResponse;
      content = data.choices?.[0]?.message?.content ?? "";
      modelName = data.model;
      providerId = provider.id;
      providerLabel = provider.label;
    }

    let parsed: { fields?: unknown; composed?: unknown; tiers?: unknown };
    try {
      parsed = parseJsonLoose(content) as typeof parsed;
    } catch {
      throw new HttpError(
        502,
        "ai_provider_bad_response",
        `${providerLabel} returned non-JSON content: ${content.slice(0, 200)}`,
      );
    }

    const composed = cleanComposedBlock(parsed?.composed);
    const tiers = cleanTiers(parsed?.tiers);
    let fields = cleanComposedFields(parsed?.fields);
    let seeded = false;
    if (fields.length === 0) {
      fields = DEFAULT_COMPOSED_FIELDS.map((f) => ({ ...f }));
      seeded = true;
    }

    const built = buildSpec({
      goalId: payload.goalId,
      title: payload.goalTitle || "Custom tracker",
      kind: "manual",
      widget: "COMPOSED",
      reasoning: "User-described custom tracker (compose-widget).",
      composed,
      fields,
      tiers,
    });

    if (!built.ok) {
      // Retry once with the safe default field set — covers the rare case
      // where the model's fields passed our cleaner but tripped the shared
      // validator (e.g. a duplicate that survived slugging).
      const fallback = buildSpec({
        goalId: payload.goalId,
        title: payload.goalTitle || "Custom tracker",
        kind: "manual",
        widget: "COMPOSED",
        reasoning: "User-described custom tracker (compose-widget, seeded).",
        composed,
        fields: DEFAULT_COMPOSED_FIELDS.map((f) => ({ ...f })),
        tiers,
      });
      if (!fallback.ok) {
        throw new HttpError(
          422,
          "compose_failed",
          "Couldn't turn that into a tracker. Try describing the specific things you'd log each period.",
        );
      }
      logger.debug(
        { userId: session.userId.toHexString(), goalId: payload.goalId, provider: providerId },
        "[ai] compose-widget seeded default fields",
      );
      res.json({ spec: fallback.spec, seeded: true, model: modelName, provider: providerId });
      return;
    }

    logger.debug(
      {
        userId: session.userId.toHexString(),
        goalId: payload.goalId,
        fields: fields.length,
        cadence: composed?.cadence ?? null,
        provider: providerId,
      },
      "[ai] composed a custom widget",
    );
    res.json({ spec: built.spec, seeded, model: modelName, provider: providerId });
  } catch (err) {
    next(err);
  }
}
