/**
 * OpenAI-compatible streaming classifier. Drives Mistral, GLM/Z.ai, or
 * any other endpoint that speaks the OpenAI chat-completions wire
 * format with `stream: true` + SSE.
 *
 * Per-goal architecture
 *   - One chat-completion call per goal
 *   - Bounded concurrency (default 3, capped at 10)
 *   - Each call streams token-by-token; we surface them as
 *     GOAL_REASONING events and accumulate them into a JSON buffer
 *   - When the upstream stream ends, we parse the buffer, validate
 *     against the spec schema, and emit either GOAL_CLASSIFIED or
 *     GOAL_FAILED
 *
 * Why one call per goal instead of one batch call?
 *   - Maps cleanly onto the "reading → classifying → done" UX —
 *     each goal is its own mini-narrative
 *   - JSON mode is more reliable on a single object than a big array
 *   - A single failing goal doesn't invalidate the whole response
 *   - Parallelism hides the fixed per-call latency
 *
 * Ported from apps/web/src/features/analyst/ai/mistral-classifier.js
 * (M3.2). Same algorithm, same prompt, TypeScript types added.
 */

import { validateSpec } from "@espace-devhub/shared/goal-specs";
import { AnalysisEvents, type AnalysisEvent } from "./events.js";
import { SPEC_RESPONSE_SCHEMA } from "./spec-schema.js";

/**
 * One Q→A pair from the user's saved goal-context answers. Front-end
 * resolves the question id to its `prompt` text before sending — the
 * classifier shouldn't need to know about our internal id slugs.
 *
 * Phase C: when present, this block is rendered into the user prompt
 * BELOW the rubric so the classifier can use the user's own definitions
 * for vague terms like "quality standards" or "success criteria" that
 * a first-pass classification would have to ask about via `context`.
 */
export interface GoalContextAnswer {
  prompt: string;
  answer: string;
}

export interface GoalForClassification {
  id: string;
  title: string;
  description?: string;
  parentL1Title?: string;
  kind: "L1" | "L2";
  /** Optional user-supplied context answers for re-analysis. */
  contextAnswers?: GoalContextAnswer[];
}

export interface ClassifierConfig {
  apiKey: string;
  url: string;
  model: string;
  /** Provider name for error messages. */
  label: string;
  /** Provider-specific extra headers (OpenRouter attribution etc.). */
  extraHeaders?: Record<string, string>;
  /** 1-10. Default 3. */
  concurrency?: number;
}

export interface ClassifyOptions {
  signal?: AbortSignal;
}

export interface ClassifierPort {
  classify(
    goals: GoalForClassification[],
    options?: ClassifyOptions,
  ): AsyncGenerator<AnalysisEvent, void, unknown>;
}

// ─── system prompt ───────────────────────────────────────────────────

/**
 * Build the classifier's system prompt.
 *
 * Design notes (kept short here, expanded in the prompt body):
 *
 * 1. Every widget has ONE valid `kind` (auto OR manual). The previous
 *    version of this prompt described widget kinds and spec kinds as
 *    two independent dimensions, and the model occasionally produced
 *    combinations like `{ widget: TURNAROUND, kind: manual }` which
 *    the validator then rejected. We now bind each widget to its
 *    canonical kind explicitly, in one place, with a hard "MUST" rule.
 *
 * 2. The 5 AUTO data-source widgets pair 1:1 with the 5 valid metric
 *    enum values. We list them as pairs so the model never has to
 *    "pick a metric" separately from "pick a widget" — the widget
 *    choice determines the metric. We also give each metric a one-line
 *    semantic description + an example goal phrasing, which is what
 *    the old prompt lacked.
 *
 * 3. We include a small "examples" section at the end (goal → expected
 *    spec). Few-shot examples are the most reliable way to anchor
 *    structural choices for non-reasoning models.
 */
function buildSystemPrompt(): string {
  return [
    "You are the Goal Analyst inside a personal performance dashboard.",
    "",
    "The user has performance goals (L1 high-level, L2 specific). Your job",
    "is to classify ONE goal and return a strict JSON spec describing how",
    "a dashboard widget should track it.",
    "",
    "═══ WIDGET CATALOG ═══════════════════════════════════════════════",
    "",
    "Each widget has EXACTLY ONE valid `kind`. Do not mix.",
    "",
    "AUTO widgets (pulled from GitHub / GitLab / Jira automatically — MUST",
    "have `kind: \"auto\"`):",
    "",
    "  MERGED_COUNT   — How many PRs/MRs the user has merged.",
    "                   metric: \"merged_count\"",
    "                   Pick when goal says: \"ship N features\", \"merge X PRs\",",
    '                   "deliver N pieces of code per sprint".',
    "",
    "  REVIEW_ROUNDS  — Average reviewer comment rounds per PR. Low = clean",
    "                   first-review pass rate, high = ping-pong reviews.",
    "                   metric: \"avg_rounds\"",
    "                   Pick when goal says: \"minimize PR comments\", \"first-",
    '                   review pass rate", "reduce back-and-forth in code review".',
    "",
    "  TURNAROUND     — Median time from PR open → merge (in days).",
    "                   metric: \"median_turnaround\"",
    "                   Pick when goal says: \"faster PR turnaround\", \"reduce",
    '                   merge latency", "MTTM".',
    "",
    "  LINKAGE        — Percentage of merged PRs that reference a Jira ticket.",
    "                   metric: \"linkage_pct\"",
    "                   Pick when goal says: \"link every PR to a ticket\",",
    '                   "traceability", "Jira coverage".',
    "",
    "  TICKET_CYCLE   — Median Jira ticket cycle time (in-progress → done).",
    "                   metric: \"ticket_cycle_time\"",
    "                   Pick when goal says: \"reduce ticket cycle time\",",
    '                   "close tickets faster", "Jira lead time".',
    "",
    "  CODE_RUBRIC    — AI grades each PR against a user-supplied rubric.",
    "                   SPECIAL: NO `source` block, NO metric. Instead emit",
    "                   a `context.required: true` with a list-kind question",
    '                   whose `id` is "quality-standards".',
    "                   Pick when goal says: \"agreed quality standards\",",
    '                   "no styling issues", "code meets team guidelines",',
    '                   "reviewer concerns addressed".',
    "",
    "MANUAL widgets (user self-reports — MUST have `kind: \"manual\"`):",
    "",
    "  COUNTER        — Increment-style numeric tally (e.g. mentoring hours).",
    "  SCALE          — 1-5 scale rating (e.g. confidence, satisfaction).",
    "  MILESTONE      — Checklist of one-off items, ticked as done.",
    "  DATE_LOG       — Date stamps for recurring events.",
    "  FREE_TEXT      — Journal / qualitative reflection.",
    "  BEFORE_AFTER   — Single before/after snapshot (e.g. team survey).",
    "",
    "HYBRID — only when a goal genuinely has two halves: one auto-trackable",
    "AND one self-reported. Set `kind: \"hybrid\"` and emit BOTH `source` AND",
    "`manual`. Pick the widget that represents the MEASURABLE half (one of",
    "the 5 AUTO data-source widgets, never CODE_RUBRIC).",
    "",
    "═══ SOURCE BLOCK ═════════════════════════════════════════════════",
    "",
    "All AUTO widgets EXCEPT CODE_RUBRIC require a `source` object.",
    "The widget choice determines the metric (1:1 — see catalog above).",
    "",
    "  {",
    '    "provider": "github" | "gitlab" | "jira" | "combined",',
    '    "metric":   "merged_count" | "avg_rounds" | "median_turnaround"',
    '              | "linkage_pct"  | "ticket_cycle_time",',
    '    "window":  "30d" | "90d" | "quarter",',
    '    "target":  { "op": "<=" | ">=" | "=", "value": <number> }   // optional',
    "  }",
    "",
    'Use "combined" when the user works in both GitHub and GitLab. Use',
    '"jira" only for TICKET_CYCLE (the only Jira-native metric).',
    "",
    "ABSOLUTELY FORBIDDEN — metric values other than the 5 listed above.",
    'Do NOT invent metrics like "pr_review_speed" or "uptime_compliance".',
    "If no metric in the catalog fits, the goal is MANUAL, not AUTO.",
    "",
    "═══ MANUAL BLOCK ═════════════════════════════════════════════════",
    "",
    "All MANUAL widgets (and the manual half of HYBRID) require:",
    "  {",
    '    "prompt":  <short question the UI asks the user>,',
    '    "cadence": "daily" | "weekly" | "biweekly" | "monthly"',
    '             | "quarterly" | "per-incident" | "milestone" | "continuous",',
    '    "unit":    <optional, what the number means, e.g. "mentoring hours">,',
    '    "items":   [<milestone labels>]   // ONLY for MILESTONE widget',
    '    "target":  { "op", "value", "period" }   // optional',
    "  }",
    "",
    "Cadence picks:",
    '  - "per-incident"  → SLA / reliability / incident-driven goals',
    '  - "milestone"     → one-off deliverables, deadlines, projects',
    '  - "continuous"    → always-on posture (uptime, on-call coverage)',
    '  - "quarterly"     → performance-cycle / OKR-aligned goals',
    '  - "monthly"/"weekly"/"daily" → habit-style tracking',
    "",
    "═══ OPTIONAL BLOCKS ══════════════════════════════════════════════",
    "",
    "`context` — emit when the goal references concepts ONLY the user can",
    "define (\"agreed quality standards\", \"success criteria\", \"acceptance",
    "rules\"). Keep it to 1-3 questions:",
    "  {",
    '    "required": true,',
    '    "questions": [{',
    '      "id": <stable-slug>,',
    '      "prompt": <short question>,',
    '      "kind": "text" | "list" | "number" | "select",',
    '      "placeholder": <example text>,                // optional',
    '      "options": [<string>]                          // required for kind=select',
    "    }]",
    "  }",
    "",
    "`delegated` — emit when the goal is evaluated by a HUMAN judge (manager,",
    "senior, peer) and the user should NOT self-track it day-to-day. Signals:",
    '"assessed by", "judged by manager", "performance review", "succession',
    'readiness", "evaluated by senior". Shape:',
    "  {",
    '    "delegated": true,',
    '    "judge":     "manager" | "senior" | "peer",',
    '    "note":      <one-line explanation>',
    "  }",
    "Even when delegated, STILL pick a widget + matching source/manual block",
    "so the user can opt into self-tracking if they want.",
    "",
    "`untrackable` — emit when the goal genuinely doesn't map to any widget",
    "in the catalogue right now. Examples of when to use it:",
    "  • the needed integration isn't connected (e.g. a CI/CD-uptime metric",
    "    when no monitoring tool is wired up)",
    "  • the goal is too vague to instrument without a conversation",
    "    (e.g. \"improve team morale\")",
    "  • the activity is intentionally one-off and a widget would feel forced",
    "  • compliance/legal goals where tracking itself is sensitive",
    "Shape:",
    "  {",
    '    "reason": <one sentence explaining why no widget fits yet>',
    "  }",
    "Still pick a best-guess widget (your closest match) and best-guess kind",
    "so the spec stays editable. When `untrackable` is set, the source and",
    "manual blocks are OPTIONAL — set them to null unless they make obvious",
    "sense. The dashboard renders an \"untrackable · <reason>\" banner instead",
    "of the widget body. The user can clear the flag later to start tracking.",
    "",
    "Prefer `untrackable` over forcing a bad widget choice. Hallucinating a",
    "MANUAL/SCALE widget with a vague prompt for a goal that can't really be",
    "measured is worse than admitting the gap.",
    "",
    "═══ USER-SUPPLIED CONTEXT ════════════════════════════════════════",
    "",
    "Some calls include a \"User-supplied context (authoritative...)\" block",
    "below the rubric. When present:",
    "  • Treat those answers as the user's GROUND TRUTH for any vague",
    "    concepts in the goal (\"quality standards\", \"success criteria\",",
    "    \"agreed definitions\"). The user has already defined them — your",
    "    job is to pick the widget that fits THAT definition.",
    "  • Do NOT re-emit a `context.required: true` question asking the",
    "    same thing back. The answer is already on the prompt.",
    "  • The user's answers may push you AWAY from the widget a context-",
    "    less classification would have picked. Example: a goal \"All code",
    "    meets team standards\" with answers like \"PR must close a Jira",
    "    ticket\" is closer to LINKAGE than CODE_RUBRIC. Use the answers",
    "    as the strongest signal.",
    "",
    "═══ OUTPUT SCHEMA ════════════════════════════════════════════════",
    "",
    "Return ONE JSON object. No prose, no markdown, no code fences. Shape:",
    "  {",
    '    "kind":        "auto" | "manual" | "hybrid",',
    '    "widget":      <one of the 12 widget kinds above>,',
    '    "reasoning":   <1-2 sentence explanation, shown to user>,',
    '    "source":      {...} | null,',
    '    "manual":      {...} | null,',
    '    "context":     {...} | null,',
    '    "delegated":   {...} | null,',
    '    "untrackable": {...} | null',
    "  }",
    "",
    "HARD RULES (validator rejects on any violation):",
    "  • If widget is one of MERGED_COUNT, REVIEW_ROUNDS, TURNAROUND,",
    '    LINKAGE, TICKET_CYCLE  →  kind MUST be "auto" and `source` MUST',
    "    be set with the matching metric.",
    "  • If widget is CODE_RUBRIC  →  kind MUST be \"auto\", `source` MUST",
    "    be null, `context.required` MUST be true with a question whose",
    '    id is "quality-standards".',
    "  • If widget is COUNTER, SCALE, MILESTONE, DATE_LOG, FREE_TEXT,",
    '    BEFORE_AFTER  →  kind MUST be "manual" and `manual` MUST be set.',
    '  • If kind is "hybrid"  →  widget must be one of the 5 data-source',
    "    AUTO widgets (NOT CODE_RUBRIC), and BOTH `source` AND `manual`",
    "    MUST be set.",
    "",
    "═══ EXAMPLES ═════════════════════════════════════════════════════",
    "",
    'Goal: "Merge at least 8 PRs per sprint."',
    "→ {",
    '    "kind": "auto", "widget": "MERGED_COUNT",',
    '    "reasoning": "Sprint-level PR throughput tracked from merged history.",',
    '    "source": { "provider": "combined", "metric": "merged_count",',
    '                "window": "30d", "target": { "op": ">=", "value": 8 } },',
    '    "manual": null, "context": null, "delegated": null',
    "  }",
    "",
    'Goal: "Reduce average PR turnaround to under 2 days."',
    "→ {",
    '    "kind": "auto", "widget": "TURNAROUND",',
    '    "reasoning": "Median open→merge time is computed directly from PR history.",',
    '    "source": { "provider": "combined", "metric": "median_turnaround",',
    '                "window": "quarter", "target": { "op": "<=", "value": 2 } },',
    '    "manual": null, "context": null, "delegated": null',
    "  }",
    "",
    'Goal: "Mentor two junior engineers — 1 hour each per week."',
    "→ {",
    '    "kind": "manual", "widget": "COUNTER",',
    '    "reasoning": "Mentoring hours are self-reported — no API observes them.",',
    '    "source": null,',
    '    "manual": { "prompt": "How many mentoring hours this week?",',
    '                "cadence": "weekly", "unit": "hours",',
    '                "target": { "op": ">=", "value": 2, "period": "week" } },',
    '    "context": null, "delegated": null',
    "  }",
    "",
    'Goal: "All code meets team quality standards."',
    "→ {",
    '    "kind": "auto", "widget": "CODE_RUBRIC",',
    '    "reasoning": "User-defined rubric, AI grades each PR against it.",',
    '    "source": null, "manual": null,',
    '    "context": { "required": true,',
    '                 "questions": [{ "id": "quality-standards",',
    '                                 "prompt": "What are the team\'s code quality standards?",',
    '                                 "kind": "list",',
    '                                 "placeholder": "e.g. test coverage, naming, docs" }] },',
    '    "delegated": null',
    "  }",
    "",
    'Goal: "Achieve 99.9% client SLA uptime compliance this quarter."',
    "→ This is reliability/SLA, NOT a code metric. No AUTO widget fits.",
    "  Use MANUAL with per-incident cadence:",
    "  {",
    '    "kind": "manual", "widget": "COUNTER",',
    '    "reasoning": "Uptime incidents are tracked per-event via incident log.",',
    '    "source": null,',
    '    "manual": { "prompt": "Log this incident\'s downtime minutes.",',
    '                "cadence": "per-incident", "unit": "minutes",',
    '                "target": { "op": "<=", "value": 43, "period": "quarter" } },',
    '    "context": null, "delegated": null, "untrackable": null',
    "  }",
    "",
    'Goal: "Improve team morale and psychological safety this quarter."',
    "→ Genuinely doesn't map to a measurable widget. Mark untrackable",
    "  with a best-guess widget so the spec is editable later:",
    "  {",
    '    "kind": "manual", "widget": "SCALE",',
    '    "reasoning": "Best-guess if instrumented, but no obvious metric exists.",',
    '    "source": null, "manual": null, "context": null, "delegated": null,',
    '    "untrackable": { "reason": "No quantitative signal for team morale ' +
      'until a pulse survey or 1:1 ritual is established." }',
    "  }",
  ].join("\n");
}

const SYSTEM_PROMPT = buildSystemPrompt();

function buildUserPrompt(goal: GoalForClassification): string {
  const lines = [
    `Goal ID: ${goal.id}`,
    `Goal kind: ${goal.kind}`,
    `Title: ${goal.title}`,
  ];
  if (goal.description) lines.push(`Description / rubric: ${goal.description}`);
  if (goal.parentL1Title) lines.push(`Parent L1 goal: ${goal.parentL1Title}`);
  // Phase C: render the user's previously-supplied context answers as
  // bullets BELOW the rubric. Marked "authoritative" so the model
  // prefers these definitions to its own guess for vague terms. When
  // present, the model should usually NOT re-emit a `context.required`
  // block — the user has already answered.
  if (goal.contextAnswers && goal.contextAnswers.length > 0) {
    lines.push("");
    lines.push("User-supplied context (authoritative — use these definitions):");
    for (const { prompt, answer } of goal.contextAnswers) {
      const trimmedPrompt = prompt.trim();
      const trimmedAnswer = answer.trim();
      if (!trimmedPrompt || !trimmedAnswer) continue;
      lines.push(`  • ${trimmedPrompt}`);
      // Indent multi-line answers two extra spaces so the bullet
      // structure stays readable when the user pasted a list or rubric.
      for (const ln of trimmedAnswer.split(/\r?\n/)) {
        lines.push(`      ${ln}`);
      }
    }
  }
  lines.push("", "Classify this goal. Respond with a single JSON object.");
  return lines.join("\n");
}

// ─── single-goal streaming call ──────────────────────────────────────

interface PerCallOpts {
  apiKey: string;
  url: string;
  model: string;
  label: string;
  extraHeaders: Record<string, string>;
  signal?: AbortSignal;
}

async function* classifyOneGoal(
  goal: GoalForClassification,
  opts: PerCallOpts,
): AsyncGenerator<AnalysisEvent, void, unknown> {
  yield AnalysisEvents.goalStarted({
    goalId: goal.id,
    title: goal.title,
    parentL1: goal.parentL1Title,
  });

  // Prefer JSON-Schema response_format mode — locks every enum the
  // catalogue advertises (provider, metric, window, cadence, etc.)
  // so the model can't return hallucinated values like
  // `uptime_compliance` for source.metric. The fallback below handles
  // providers that don't support `json_schema` (older OpenRouter-routed
  // models, GLM in certain modes) by retrying with the older
  // `json_object` mode + an explicit error from the upstream provider.
  const baseBody = {
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(goal) },
    ],
    temperature: 0.2,
    stream: true,
  } as const;

  const buildBody = (responseFormat: unknown) => ({
    ...baseBody,
    response_format: responseFormat,
  });

  const requestWithFormat = async (
    responseFormat: unknown,
  ): Promise<Awaited<ReturnType<typeof fetch>>> =>
    fetch(opts.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...opts.extraHeaders,
      },
      body: JSON.stringify(buildBody(responseFormat)),
      signal: opts.signal,
    });

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await requestWithFormat({
      type: "json_schema",
      json_schema: SPEC_RESPONSE_SCHEMA,
    });
  } catch (err) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // If the provider rejects json_schema (some return 400 with a
  // "response_format type must be ..." error, others ignore it
  // silently — we only retry on the explicit 400), fall back to the
  // older json_object mode. The prompt-side enum reminders still keep
  // the model honest, just without the provider-side schema lock.
  if (res.status === 400) {
    const errText = await res.clone().text().catch(() => "");
    const looksLikeSchemaUnsupported =
      /response_format/i.test(errText) ||
      /json[_-]?schema/i.test(errText) ||
      /unsupported/i.test(errText);
    if (looksLikeSchemaUnsupported) {
      try {
        res = await requestWithFormat({ type: "json_object" });
      } catch (err) {
        yield AnalysisEvents.goalFailed({
          goalId: goal.id,
          error: `Network error on json_object fallback: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        return;
      }
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `${opts.label} ${res.status}: ${errText.slice(0, 300)}`,
    });
    return;
  }
  if (!res.body) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `${opts.label}: empty response stream`,
    });
    return;
  }

  // OpenAI-format SSE: `data: {json}\n\n`, terminated by `data: [DONE]`.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let jsonBuffer = "";

  try {
    while (true) {
      if (opts.signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep last (possibly partial) line
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed: { choices?: Array<{ delta?: { content?: string } }> };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          jsonBuffer += delta;
          yield AnalysisEvents.goalReasoning({
            goalId: goal.id,
            chunk: delta,
          });
        }
      }
    }
  } catch (err) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  let parsedSpec: unknown;
  try {
    parsedSpec = JSON.parse(jsonBuffer.trim());
  } catch (err) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Invalid JSON from classifier: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // The model returns the spec body without the goalId/title — caller
  // attaches them so the spec is self-describing.
  const obj = (parsedSpec as Record<string, unknown>) ?? {};
  const candidate: Record<string, unknown> = {
    goalId: goal.id,
    title: goal.title,
    kind: obj.kind,
    widget: obj.widget,
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
    source: obj.source ?? null,
    manual: obj.manual ?? null,
    context: obj.context ?? null,
    delegated: obj.delegated ?? null,
    untrackable: obj.untrackable ?? null,
    classifiedAt: Date.now(),
  };
  const result = validateSpec(candidate);
  if (!result.ok) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Spec failed validation: ${result.errors.join("; ")}`,
    });
    return;
  }
  yield AnalysisEvents.goalClassified({
    goalId: goal.id,
    spec: result.spec,
  });
}

// ─── factory ─────────────────────────────────────────────────────────

/**
 * Build a classifier port. The returned object has `classify(goals, opts)`
 * which yields AnalysisEvents.
 *
 * Concurrency model:
 *   - Up to `concurrency` per-goal iterators run at once
 *   - We race their pending `next()` promises and yield whichever
 *     resolves first; this interleaves events across goals so the UI
 *     streams per-goal progress in real time
 *   - When an iterator finishes, we start the next queued goal
 *   - On `signal.aborted`, we stop pulling and emit COMPLETE with the
 *     partial count
 */
export function createMistralClassifier(
  config: ClassifierConfig,
): ClassifierPort {
  if (!config.apiKey) {
    throw new Error("createMistralClassifier: `apiKey` is required");
  }
  const url = config.url;
  const model = config.model;
  const label = config.label;
  const extraHeaders = config.extraHeaders ?? {};
  const concurrency = Math.max(
    1,
    Math.min(10, config.concurrency ?? 3),
  );

  return {
    async *classify(
      goals: GoalForClassification[],
      options: ClassifyOptions = {},
    ): AsyncGenerator<AnalysisEvent, void, unknown> {
      const startedAt = Date.now();
      yield AnalysisEvents.start({
        totalGoals: goals.length,
        startedAt,
      });

      if (goals.length === 0) {
        yield AnalysisEvents.complete({ count: 0, elapsedMs: 0 });
        return;
      }

      const queue = [...goals];
      let completedCount = 0;
      type RunningIter = AsyncGenerator<AnalysisEvent, void, unknown>;
      const runningIters = new Set<RunningIter>();
      const runningReaders = new Map<
        RunningIter,
        { next: Promise<IteratorResult<AnalysisEvent>> }
      >();

      const startOne = (): boolean => {
        const goal = queue.shift();
        if (!goal) return false;
        const iter = classifyOneGoal(goal, {
          apiKey: config.apiKey,
          url,
          model,
          label,
          extraHeaders,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        runningIters.add(iter);
        runningReaders.set(iter, { next: iter.next() });
        return true;
      };

      // Prime up to `concurrency` iterators.
      for (let i = 0; i < concurrency; i += 1) {
        if (!startOne()) break;
      }

      while (runningIters.size > 0) {
        if (options.signal?.aborted) break;

        // Race whichever reader resolves next.
        const winner = await Promise.race(
          [...runningIters].map((iter) => {
            const reader = runningReaders.get(iter);
            if (!reader) {
              return Promise.reject(new Error("classifier: missing reader"));
            }
            return reader.next.then((res) => ({ iter, res }));
          }),
        );
        const { iter, res } = winner;
        if (res.done) {
          runningIters.delete(iter);
          runningReaders.delete(iter);
          completedCount += 1;
          startOne();
          continue;
        }
        yield res.value;
        const reader = runningReaders.get(iter);
        if (reader) {
          reader.next = iter.next();
        }
      }

      yield AnalysisEvents.complete({
        count: completedCount,
        elapsedMs: Date.now() - startedAt,
      });
    },
  };
}
