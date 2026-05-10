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

import {
  SPEC_KIND_META,
  SPEC_VARIANTS,
  SPEC_KINDS,
} from "./spec-types.js";
import { validateSpec } from "./spec-validator.js";
import { AnalysisEvents, type AnalysisEvent } from "./events.js";

export interface GoalForClassification {
  id: string;
  title: string;
  description?: string;
  parentL1Title?: string;
  kind: "L1" | "L2";
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

function buildSystemPrompt(): string {
  const widgetCatalog = Object.entries(SPEC_KIND_META)
    .map(
      ([kind, meta]) =>
        `  - ${kind}  (${meta.variant})  — ${meta.label}`,
    )
    .join("\n");

  return [
    "You are the Goal Analyst inside a personal performance dashboard.",
    "",
    "The user has performance goals (L1 high-level, L2 specific). Your job",
    "is to classify ONE goal and return a strict JSON spec describing how",
    "a dashboard widget should track it.",
    "",
    "You must choose ONE of these widget kinds:",
    widgetCatalog,
    "",
    'Kinds of specs (the `kind` field):',
    `  - "${SPEC_VARIANTS.AUTO}"    — the dashboard can compute this from GitHub/GitLab/Jira`,
    `  - "${SPEC_VARIANTS.MANUAL}"  — the user must self-report periodically`,
    `  - "${SPEC_VARIANTS.HYBRID}"  — both: an auto metric paired with manual self-reports`,
    "",
    `Auto widgets (${SPEC_KINDS.MERGED_COUNT}, ${SPEC_KINDS.REVIEW_ROUNDS}, ${SPEC_KINDS.TURNAROUND}, ${SPEC_KINDS.LINKAGE},`,
    `${SPEC_KINDS.TICKET_CYCLE}) MUST include a \`source\` object:`,
    "  {",
    '    provider: "github"|"gitlab"|"jira"|"combined",',
    '    metric:   "merged_count"|"avg_rounds"|"median_turnaround"|"linkage_pct"|"ticket_cycle_time",',
    '    window:   "30d"|"90d"|"quarter",',
    '    target?:  { op: "<="|">="|"=", value: <number> }',
    "  }",
    "",
    `Special case — ${SPEC_KINDS.CODE_RUBRIC}: pick this widget when the goal mentions`,
    "quality / style / review standards that the USER must define (e.g.",
    '"agreed quality standards", "no styling issues", "reviewer concerns',
    'addressed", "code meets team guidelines"). Emit `kind: "auto"`, NO',
    "`source` block, and a `context.required: true` with a list-kind question",
    "whose id is `quality-standards` so the widget knows which answer is",
    "the rubric. Also emit a small `manual` block so un-delegation makes",
    "sense, OR leave `manual: null`. Grading reads merged+open PRs from",
    "Jan 1 YTD and scores each one against the user's rubric.",
    "",
    `Manual widgets (${SPEC_KINDS.COUNTER}, ${SPEC_KINDS.SCALE}, ${SPEC_KINDS.MILESTONE}, ${SPEC_KINDS.DATE_LOG}, ${SPEC_KINDS.FREE_TEXT},`,
    `${SPEC_KINDS.BEFORE_AFTER}) MUST include a \`manual\` object:`,
    "  {",
    "    prompt:  <short question the UI asks the user>,",
    '    cadence: "daily"|"weekly"|"biweekly"|"monthly"|"quarterly"',
    '              |"per-incident"|"milestone"|"continuous",',
    '    unit?:   <what the number means, e.g. "mentoring hours">,',
    "    items?:  [<milestone labels if widget is MILESTONE>],",
    "    target?: { op, value, period? }",
    "  }",
    "",
    '  Cadence guidance — pick the closest match. Use "per-incident" for',
    '  SLA / reliability / response-time goals, "milestone" for one-off',
    '  deliverables, "continuous" for always-on posture (e.g. uptime).',
    "",
    "Hybrid specs include BOTH `source` and `manual`.",
    "",
    "Guidance:",
    "  - Pick AUTO when the goal literally mentions code output, PR/MR counts,",
    "    review speed, Jira linkage, or ticket cycle time.",
    "  - Pick MANUAL when the goal is about mentoring, leadership, learning,",
    "    documentation, team behaviour, knowledge-sharing — things no API",
    "    observes.",
    "  - Pick HYBRID only when a goal has two halves, e.g. \"ship features AND",
    "    get senior review coverage\" — one auto-trackable + one self-reported.",
    "",
    "Two OPTIONAL blocks you may also emit:",
    "",
    "`context` — when the goal references concepts only the user or team can",
    "define (e.g. \"agreed quality standards\", \"success criteria\",",
    "\"acceptance rules\"), emit a list of questions the dashboard must ask",
    "BEFORE tracking starts:",
    "  {",
    "    required: true,",
    "    questions: [",
    "      {",
    "        id: <stable-slug>,",
    "        prompt: <short question>,",
    '        kind:  "text"|"list"|"number"|"select",',
    "        placeholder?: <example text>,",
    "        options?: [<string>]                // required for kind=select",
    "      }",
    "    ]",
    "  }",
    "  Keep this list minimal — 1–3 questions. Only emit `context` when",
    "  tracking is genuinely meaningless without the answer.",
    "",
    "`delegated` — when the goal is evaluated by a human (manager, senior,",
    "or peer) and the user should NOT self-track it, emit:",
    "  {",
    "    delegated: true,",
    '    judge:  "manager"|"senior"|"peer",',
    "    note:   <one-line explanation>",
    "  }",
    "  Signals: \"assessed by\", \"judged by manager\", \"quarterly review\",",
    "  \"succession readiness\", \"evaluated by senior\", \"performance panel\".",
    "  When `delegated.delegated` is true you should STILL pick a widget kind",
    "  and a matching block (source/manual) so the user can opt back into",
    "  self-tracking later.",
    "",
    "Output:",
    "  Return ONE JSON object. No prose. No markdown. No code fences.",
    "  Schema:",
    "  {",
    '    "kind":      "auto"|"manual"|"hybrid",',
    '    "widget":    <one of the widget kinds above>,',
    '    "reasoning": <1-2 sentence explanation, shown to user>,',
    '    "source":    {...}  // or null',
    '    "manual":    {...}  // or null',
    '    "context":   {...}  // or null',
    '    "delegated": {...}  // or null',
    "  }",
    "",
    "Do not wrap in markdown fences. Do not include the goalId — the caller",
    "attaches it. Just the object.",
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

  const requestBody = {
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(goal) },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
    stream: true,
  };

  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(opts.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...opts.extraHeaders,
      },
      body: JSON.stringify(requestBody),
      signal: opts.signal,
    });
  } catch (err) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
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
