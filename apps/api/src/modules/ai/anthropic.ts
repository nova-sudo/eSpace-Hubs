/**
 * Native Anthropic (Claude) provider — uses the official @anthropic-ai/sdk
 * `/v1/messages` API, NOT the OpenAI-compatible `/chat/completions` shape
 * the other providers share. Claude's request/response/streaming format is
 * different enough that bolting it onto the OpenAI gateway would be a shim;
 * this module is the native path the AI controllers + classifier branch to
 * when the requested provider id is "anthropic".
 *
 * Config:
 *   ANTHROPIC_API_KEY   server-side key (required)
 *   ANTHROPIC_MODEL     optional model override (default: claude-opus-4-8)
 *
 * System prompts go in the top-level `system` param (Claude separates them
 * from the user/assistant turn list); we never put a system role inside
 * `messages`.
 */

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { HttpError } from "../../middleware/error-handler.js";
import { AnalysisEvents } from "./classifier/events.js";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  specEventFromBuffer,
  type ClassifierPort,
  type ClassifyOptions,
  type GoalForClassification,
} from "./classifier/mistral-classifier.js";
import type { AnalysisEvent } from "./classifier/events.js";

export const ANTHROPIC_ID = "anthropic";

export function isAnthropicId(id: string): boolean {
  return id === ANTHROPIC_ID;
}

/**
 * Backend: Amazon Bedrock (AWS-managed Claude, AWS creds) vs the direct
 * Anthropic API (a single ANTHROPIC_API_KEY). Toggle with ANTHROPIC_BEDROCK.
 * Both speak the identical `messages.create` API — only the client and the
 * model-id format differ.
 */
function useBedrock(): boolean {
  const v = (process.env.ANTHROPIC_BEDROCK || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Default model — Sonnet 4.6, strong + cost-sane (classification + grading
 * run one call per goal / per PR). Override via ANTHROPIC_MODEL.
 *
 * Bedrock model ids are region-/inference-profile-specific and carry an
 * `anthropic.` (often `us.anthropic.…:0`) prefix, so on Bedrock you should
 * set ANTHROPIC_MODEL to YOUR account's exact id. The default below is a
 * best-effort starting point.
 */
export function anthropicModel(): string {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  return useBedrock() ? "anthropic.claude-sonnet-4-6" : "claude-sonnet-4-6";
}

type AnyClient = Anthropic | AnthropicBedrock;
let client: AnyClient | null = null;

function getClient(): AnyClient {
  if (client) return client;
  if (useBedrock()) {
    // AnthropicBedrock resolves AWS creds from the standard chain
    // (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN, or an
    // IAM role). Region defaults to us-east-1 if AWS_REGION is unset.
    client = new AnthropicBedrock(
      process.env.AWS_REGION ? { awsRegion: process.env.AWS_REGION } : {},
    );
    return client;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpError(
      500,
      "ai_provider_unconfigured",
      "Claude has no credentials. Set ANTHROPIC_API_KEY, or enable Bedrock with ANTHROPIC_BEDROCK=1 + AWS creds, in the API env and restart.",
    );
  }
  client = new Anthropic({ apiKey });
  return client;
}

function textOf(blocks: Anthropic.Messages.ContentBlock[]): string {
  return blocks
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

interface CompleteInput {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
}

/**
 * One non-streaming completion — used by chat + the two graders. The
 * grader prompts already instruct "return ONE JSON object, no prose"; the
 * caller parses `content` defensively. Thinking is left off (omitted) so
 * the model answers directly.
 */
export async function anthropicComplete(
  opts: CompleteInput,
): Promise<{ content: string; model: string; usage: unknown }> {
  const c = getClient();
  let msg: Anthropic.Messages.Message;
  try {
    msg = await c.messages.create({
      model: anthropicModel(),
      max_tokens: opts.maxTokens ?? 2048,
      ...(opts.system ? { system: opts.system } : {}),
      messages: opts.messages,
    });
  } catch (err) {
    throw mapSdkError(err);
  }
  return { content: textOf(msg.content), model: msg.model, usage: msg.usage };
}

/**
 * Map SDK errors onto the same HttpError shape the OpenAI path uses.
 * Duck-typed on `.status` so it works for both the direct and Bedrock
 * SDK error classes.
 */
function mapSdkError(err: unknown): HttpError {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") {
    const rateLimited = status === 429;
    return new HttpError(
      status,
      rateLimited ? "ai_provider_rate_limited" : "ai_provider_error",
      `Claude ${status}: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      rateLimited ? 30_000 : undefined,
    );
  }
  return new HttpError(
    502,
    "ai_provider_unreachable",
    `Network error reaching Claude: ${err instanceof Error ? err.message : String(err)}`,
  );
}

/* ─────────────────────── classifier ─────────────────────── */

/**
 * Classify ONE goal with Claude. Non-streaming per goal (we get the whole
 * spec JSON in one call, then validate via the shared `specEventFromBuffer`)
 * — the per-goal start/classified/failed events still drive the analyst UI;
 * only the token-by-token "reasoning" typewriter is absent vs. the OpenAI
 * streamer, which is purely cosmetic.
 */
async function* classifyOneGoalAnthropic(
  goal: GoalForClassification,
  c: AnyClient,
  signal?: AbortSignal,
): AsyncGenerator<AnalysisEvent, void, unknown> {
  yield AnalysisEvents.goalStarted({
    goalId: goal.id,
    title: goal.title,
    parentL1: goal.parentL1Title,
  });

  let text: string;
  try {
    const msg = await c.messages.create(
      {
        model: anthropicModel(),
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(goal) }],
      },
      signal ? { signal } : {},
    );
    text = textOf(msg.content);
  } catch (err) {
    if (signal?.aborted) return;
    yield AnalysisEvents.goalFailed({
      goalId: goal.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  yield specEventFromBuffer(goal, text);
}

/**
 * Build an Anthropic classifier port with the SAME concurrency-racing
 * orchestration the OpenAI classifier uses, so the NDJSON stream
 * interleaves per-goal events identically.
 */
export function createAnthropicClassifier(concurrency = 3): ClassifierPort {
  const cap = Math.max(1, Math.min(10, concurrency));
  const c = getClient();

  return {
    async *classify(
      goals: GoalForClassification[],
      options: ClassifyOptions = {},
    ): AsyncGenerator<AnalysisEvent, void, unknown> {
      const startedAt = Date.now();
      yield AnalysisEvents.start({ totalGoals: goals.length, startedAt });
      if (goals.length === 0) {
        yield AnalysisEvents.complete({ count: 0, elapsedMs: 0 });
        return;
      }

      const queue = [...goals];
      let completedCount = 0;
      type Iter = AsyncGenerator<AnalysisEvent, void, unknown>;
      const iters = new Set<Iter>();
      const readers = new Map<Iter, Promise<IteratorResult<AnalysisEvent>>>();

      const startOne = (): boolean => {
        const goal = queue.shift();
        if (!goal) return false;
        const it = classifyOneGoalAnthropic(goal, c, options.signal);
        iters.add(it);
        readers.set(it, it.next());
        return true;
      };

      for (let i = 0; i < cap; i += 1) if (!startOne()) break;

      while (iters.size > 0) {
        if (options.signal?.aborted) break;
        const winner = await Promise.race(
          [...iters].map((it) =>
            (readers.get(it) as Promise<IteratorResult<AnalysisEvent>>).then(
              (res) => ({ it, res }),
            ),
          ),
        );
        const { it, res } = winner;
        if (res.done) {
          iters.delete(it);
          readers.delete(it);
          completedCount += 1;
          startOne();
          continue;
        }
        yield res.value;
        readers.set(it, it.next());
      }

      yield AnalysisEvents.complete({
        count: completedCount,
        elapsedMs: Date.now() - startedAt,
      });
    },
  };
}
