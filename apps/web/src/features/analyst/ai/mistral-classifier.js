/**
 * OpenAI-compatible streaming classifier (used by Mistral and GLM/Z.ai).
 *
 * Runs SERVER-SIDE in the `/api/classify-goals` route handler. Streams one
 * chat-completion call per goal (parallelized with a concurrency cap) and
 * translates the upstream SSE payloads into stable AnalysisEvents.
 *
 * Why one call per goal instead of one call for the whole tree?
 *   - Per-goal calls map cleanly onto the "reading → classifying → done"
 *     process-reveal UX; each goal is its own mini-narrative in the stream
 *   - JSON mode works more reliably on a single object than a big array
 *   - A single failing goal doesn't invalidate the whole response
 *   - Parallelism hides the fixed per-call latency
 *
 * The factory accepts `url` and `label` so the same code drives Mistral
 * AND any other OpenAI-compatible endpoint (GLM/Z.ai today, ollama or
 * vLLM tomorrow). Default values keep the legacy Mistral wiring working.
 */

import { AnalysisEvents } from "./analysis-events";
import {
  SPEC_KINDS,
  SPEC_KIND_META,
  SPEC_VARIANTS,
  validateSpec,
} from "@/features/goal-specs";

const DEFAULT_URL = "https://api.mistral.ai/v1/chat/completions";
const DEFAULT_MODEL = "mistral-small-latest";
const DEFAULT_LABEL = "Mistral";

/**
 * The system prompt is the knowledge-injection point. It teaches the model
 * the widget taxonomy and the JSON shape we expect back. Changes to
 * SPEC_KINDS / SOURCE_METRICS should be reflected here — the prompt is
 * generated from those constants at module-load time so the source of
 * truth stays the enum file.
 */
function buildSystemPrompt() {
  const widgetCatalog = Object.entries(SPEC_KIND_META)
    .map(([kind, meta]) => `  - ${kind}  (${meta.variant})  — ${meta.label}`)
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
    "Kinds of specs (the `kind` field):",
    "  - \"auto\"    — the dashboard can compute this from GitHub/GitLab/Jira",
    "  - \"manual\"  — the user must self-report periodically",
    "  - \"hybrid\"  — both: an auto metric paired with manual self-reports",
    "",
    "Auto widgets (MERGED_COUNT, REVIEW_ROUNDS, TURNAROUND, LINKAGE,",
    "TICKET_CYCLE) MUST include a `source` object:",
    "  {",
    "    provider: \"github\"|\"gitlab\"|\"jira\"|\"combined\",",
    "    metric:   \"merged_count\"|\"avg_rounds\"|\"median_turnaround\"|\"linkage_pct\"|\"ticket_cycle_time\",",
    "    window:   \"30d\"|\"90d\"|\"quarter\",",
    "    target?:  { op: \"<=\"|\">=\"|\"=\", value: <number> }",
    "  }",
    "",
    "Special case — CODE_RUBRIC: pick this widget when the goal mentions",
    "quality / style / review standards that the USER must define (e.g.",
    "\"agreed quality standards\", \"no styling issues\", \"reviewer concerns",
    "addressed\", \"code meets team guidelines\"). Emit `kind: \"auto\"`, NO",
    "`source` block, and a `context.required: true` with a list-kind question",
    "whose id is `quality-standards` so the widget knows which answer is",
    "the rubric. Also emit a small `manual` block so un-delegation makes",
    "sense, OR leave `manual: null`. Grading reads merged+open PRs from",
    "Jan 1 YTD and scores each one against the user's rubric.",
    "",
    "Manual widgets (COUNTER, SCALE, MILESTONE, DATE_LOG, FREE_TEXT,",
    "BEFORE_AFTER) MUST include a `manual` object:",
    "  {",
    "    prompt:  <short question the UI asks the user>,",
    "    cadence: \"daily\"|\"weekly\"|\"biweekly\"|\"monthly\"|\"quarterly\"",
    "              |\"per-incident\"|\"milestone\"|\"continuous\",",
    "    unit?:   <what the number means, e.g. \"mentoring hours\">,",
    "    items?:  [<milestone labels if widget is MILESTONE>],",
    "    target?: { op, value, period? }",
    "  }",
    "",
    "  Cadence guidance — pick the closest match. Use \"per-incident\" for",
    "  SLA / reliability / response-time goals, \"milestone\" for one-off",
    "  deliverables, \"continuous\" for always-on posture (e.g. uptime).",
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
    "        id: <stable-slug>,                  // e.g. \"quality-standards\"",
    "        prompt: <short question>,           // e.g. \"What counts as 'agreed quality standards'?\"",
    "        kind:  \"text\"|\"list\"|\"number\"|\"select\",",
    "        placeholder?: <example text>,",
    "        options?: [<string>]                // required for kind=select",
    "      }",
    "    ]",
    "  }",
    "  Keep this list minimal — 1–3 questions. Only emit `context` when",
    "  tracking is genuinely meaningless without the answer. Do NOT ask",
    "  questions that could be answered generically.",
    "",
    "`delegated` — when the goal is evaluated by a human (manager, senior,",
    "or peer) and the user should NOT self-track it, emit:",
    "  {",
    "    delegated: true,",
    "    judge:  \"manager\"|\"senior\"|\"peer\",",
    "    note:   <one-line explanation, e.g. \"Reviewed during quarterly 1:1\">",
    "  }",
    "  Signals: \"assessed by\", \"judged by manager\", \"quarterly review\",",
    "  \"succession readiness\", \"evaluated by senior\", \"performance panel\".",
    "  When `delegated.delegated` is true you should STILL pick a widget kind",
    "  and a matching block (source/manual) so the user can opt back into",
    "  self-tracking later — but keep it light (a MILESTONE or COUNTER is",
    "  usually enough).",
    "",
    "Output:",
    "  Return ONE JSON object. No prose. No markdown. No code fences.",
    "  Schema:",
    "  {",
    "    \"kind\":      \"auto\"|\"manual\"|\"hybrid\",",
    "    \"widget\":    <one of the widget kinds above>,",
    "    \"reasoning\": <1-2 sentence explanation, shown to user>,",
    "    \"source\":    {...}  // or null",
    "    \"manual\":    {...}  // or null",
    "    \"context\":   {...}  // or null — see above",
    "    \"delegated\": {...}  // or null — see above",
    "  }",
    "",
    "Do not wrap in markdown fences. Do not include the goalId — the caller",
    "attaches it. Just the object.",
  ].join("\n");
}

const SYSTEM_PROMPT = buildSystemPrompt();

function buildUserPrompt(goal) {
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

/**
 * Call Mistral for a single goal. Yields:
 *   - GOAL_STARTED
 *   - GOAL_REASONING (many, from the streamed tokens)
 *   - GOAL_CLASSIFIED | GOAL_FAILED
 *
 * JSON mode on Mistral returns a final JSON object; we still surface the
 * token-by-token stream as "reasoning" for the analyst UI. When the stream
 * ends we parse, validate, and emit the terminal event.
 */
async function* classifyOneGoal(goal, opts) {
  yield AnalysisEvents.goalStarted({
    goalId: goal.id,
    title: goal.title,
    parentL1: goal.parentL1Title,
  });

  const body = {
    model: opts.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(goal) },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
    stream: true,
  };

  let res;
  try {
    res = await fetch(opts.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(opts.extraHeaders || {}),
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Network error: ${err?.message || String(err)}`,
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

  // Parse the SSE stream. Both Mistral and GLM use OpenAI's format:
  // `data: {json}\n\n` with a final `data: [DONE]`.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let jsonBuffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep the last (possibly partial) line
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = parsed?.choices?.[0]?.delta?.content;
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
      error: `Stream error: ${err?.message || String(err)}`,
    });
    return;
  }

  // End of stream — jsonBuffer should hold a single JSON object.
  let parsed;
  try {
    parsed = JSON.parse(jsonBuffer.trim());
  } catch (err) {
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: `Invalid JSON from classifier: ${err?.message || err}`,
    });
    return;
  }

  // Construct a candidate spec and validate.
  const candidate = {
    goalId: goal.id,
    title: goal.title,
    kind: parsed?.kind,
    widget: parsed?.widget,
    reasoning: parsed?.reasoning || "",
    source: parsed?.source ?? null,
    manual: parsed?.manual ?? null,
    // Optional user-intervention blocks (see schema.js). The AI may omit
    // them entirely — null is the canonical "not applicable" value.
    context: parsed?.context ?? null,
    delegated: parsed?.delegated ?? null,
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
  yield AnalysisEvents.goalClassified({ goalId: goal.id, spec: result.spec });
}

/**
 * Async-iterable merge: run N worker async-iterators in parallel, yielding
 * their items in whatever order they become available. Preserves the
 * per-worker ordering (within a goal, START precedes REASONING precedes
 * CLASSIFIED) but interleaves across goals so the UI streams progress as
 * it happens.
 */
async function* mergeAsyncIterables(iterables) {
  // Each running iterator is represented by its pending next()-promise.
  const readers = iterables.map((it) => ({
    it,
    next: it.next(),
  }));
  const active = new Set(readers);
  while (active.size > 0) {
    // Race: whichever iterator resolves first, yield its value.
    const winner = await Promise.race(
      [...active].map((r) =>
        r.next.then((res) => ({ reader: r, res })),
      ),
    );
    const { reader, res } = winner;
    if (res.done) {
      active.delete(reader);
      continue;
    }
    yield res.value;
    reader.next = reader.it.next();
  }
}

/**
 * Bounded-concurrency queue — takes an array of thunks, runs `limit` at a
 * time, returns async iterables as they start. This gives us "stream N at
 * once" without importing p-queue.
 */
function* paceThunks(thunks, limit) {
  // We create each async iterator lazily so we respect the concurrency cap:
  // only when a slot opens does the next goal's fetch actually fire.
  const pending = [...thunks];
  const active = new Set();
  while (pending.length > 0 && active.size < limit) {
    const thunk = pending.shift();
    const iter = thunk();
    active.add(iter);
    yield iter;
  }
  // The consumer (mergeAsyncIterables) will pull items; when an iterator
  // completes, we DO NOT auto-start the next here — instead the factory
  // function returns ALL thunks started upfront but ratelimited via a
  // semaphore is clearer. See `createClassifyIterable` for the real impl.
}
/* eslint-disable-next-line no-unused-vars */
const _unused = paceThunks; // keep doc example in the file; not exported.

/**
 * Build a classifier port against Mistral.
 *
 * @param {object} config
 * @param {string} config.apiKey
 * @param {string} [config.model]
 * @param {string} [config.url]   OpenAI-compatible chat-completions endpoint
 * @param {string} [config.label] Human-readable provider name (used in error
 *                                messages so users see "GLM 401" not
 *                                "Mistral 401" when they're using GLM).
 * @param {Object<string,string>} [config.extraHeaders] Provider-specific
 *                                headers merged into every request (e.g.
 *                                OpenRouter's HTTP-Referer / X-Title).
 * @param {number} [config.concurrency=3]
 */
export function createMistralClassifier(config) {
  const apiKey = config?.apiKey;
  if (!apiKey) {
    throw new Error(
      "createMistralClassifier: `apiKey` is required",
    );
  }
  const url = config?.url || DEFAULT_URL;
  const model = config?.model || DEFAULT_MODEL;
  const label = config?.label || DEFAULT_LABEL;
  const extraHeaders = config?.extraHeaders || {};
  const concurrency = Math.max(1, Math.min(10, config?.concurrency ?? 3));

  return {
    /**
     * @param {Array<{id,title,description?,parentL1Title?,kind}>} goals
     * @param {{signal?: AbortSignal}} [options]
     */
    async *classify(goals, options = {}) {
      const startedAt = Date.now();
      yield AnalysisEvents.start({
        totalGoals: goals.length,
        startedAt,
      });

      if (goals.length === 0) {
        yield AnalysisEvents.complete({ count: 0, elapsedMs: 0 });
        return;
      }

      // Semaphore-style dispatch: we hand the merge helper at most
      // `concurrency` iterators at a time. When one finishes, we start
      // the next. The merge helper only knows about "running" iterators.
      const queue = [...goals];
      let completedCount = 0;
      const runningIters = new Set();
      const runningReaders = new Map(); // iter → { next }

      function startOne() {
        if (queue.length === 0) return false;
        const goal = queue.shift();
        const iter = classifyOneGoal(goal, {
          apiKey,
          url,
          model,
          label,
          extraHeaders,
          signal: options.signal,
        });
        runningIters.add(iter);
        runningReaders.set(iter, { next: iter.next() });
        return true;
      }

      // Prime up to `concurrency` iterators.
      for (let i = 0; i < concurrency; i++) {
        if (!startOne()) break;
      }

      while (runningIters.size > 0) {
        if (options.signal?.aborted) break;

        // Race whichever reader resolves next.
        const winner = await Promise.race(
          [...runningIters].map((iter) =>
            runningReaders.get(iter).next.then((res) => ({ iter, res })),
          ),
        );
        const { iter, res } = winner;
        if (res.done) {
          runningIters.delete(iter);
          runningReaders.delete(iter);
          completedCount += 1;
          startOne(); // fire the next queued goal
          continue;
        }
        yield res.value;
        runningReaders.get(iter).next = iter.next();
      }

      yield AnalysisEvents.complete({
        count: completedCount,
        elapsedMs: Date.now() - startedAt,
      });
    },
  };
}

/**
 * Silence the unused merge helper warning — kept in the file as
 * documentation for the alternate implementation path.
 */
export const __mergeAsyncIterables_forDocs = mergeAsyncIterables;
