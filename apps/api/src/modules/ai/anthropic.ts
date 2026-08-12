/**
 * Native Anthropic (Claude) provider — uses the official @anthropic-ai/sdk
 * `/v1/messages` API, NOT the OpenAI-compatible `/chat/completions` shape
 * the other providers share. Claude's request/response/streaming format is
 * different enough that bolting it onto the OpenAI gateway would be a shim;
 * this module is the native path the AI controllers + classifier branch to
 * when the requested provider id is "anthropic".
 *
 * Config:
 *   ANTHROPIC_BACKEND   litellm (default) | bedrock | direct
 *   LITELLM_API_KEY     virtual key for the LiteLLM gateway
 *   LITELLM_BASE_URL    gateway origin (default: https://litellm.espace.ws)
 *   ANTHROPIC_API_KEY   server-side key — direct backend only
 *   ANTHROPIC_MODEL     optional model override
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
 * Which backend serves Claude. All three speak the identical
 * `messages.create` API — only the client, the credentials and the
 * model-id format differ.
 *
 *   litellm  eSpace's LiteLLM gateway. One virtual key, and the gateway
 *            holds the AWS credentials. This is the supported path to
 *            Bedrock — direct Bedrock access is being switched off.
 *   bedrock  LEGACY. Talks to Amazon Bedrock directly with AWS creds.
 *   direct   api.anthropic.com with an ANTHROPIC_API_KEY.
 *
 * Selected by ANTHROPIC_BACKEND. When that is unset we honour the older
 * ANTHROPIC_BEDROCK flag so environments mid-migration keep working, then
 * fall back to whichever credential is actually present.
 */
export type AnthropicBackend = "litellm" | "bedrock" | "direct";

const LITELLM_DEFAULT_BASE_URL = "https://litellm.espace.ws";

export function anthropicBackend(): AnthropicBackend {
  const explicit = (process.env.ANTHROPIC_BACKEND || "").trim().toLowerCase();
  if (explicit === "litellm" || explicit === "bedrock" || explicit === "direct") {
    return explicit;
  }

  const legacyBedrock = (process.env.ANTHROPIC_BEDROCK || "").trim().toLowerCase();
  if (legacyBedrock === "1" || legacyBedrock === "true" || legacyBedrock === "yes") {
    return "bedrock";
  }

  // No explicit choice: a direct key with no gateway key means this env
  // predates the migration and should keep talking to api.anthropic.com.
  if (process.env.ANTHROPIC_API_KEY && !process.env.LITELLM_API_KEY) {
    return "direct";
  }
  return "litellm";
}

/**
 * Gateway origin. The Anthropic SDK appends `/v1/messages` itself, but the
 * LiteLLM UI displays the OpenAI-style `…/v1` base URL, so a pasted value
 * with `/v1` on the end is the likely mistake — trim it rather than issue
 * every request against `/v1/v1/messages`.
 */
function litellmBaseUrl(): string {
  const raw = (process.env.LITELLM_BASE_URL || LITELLM_DEFAULT_BASE_URL).trim();
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Default model — Sonnet, strong + cost-sane (classification + grading run
 * one call per goal / per PR). Override via ANTHROPIC_MODEL.
 *
 * The id is backend-specific, so each backend carries its own default:
 *   litellm  the model NAME as configured on the gateway, NOT an Anthropic
 *            or Bedrock id. `claude-sonnet-5` is the alias eSpace's gateway
 *            publishes; if the Models page in the LiteLLM UI ever lists
 *            something else, set ANTHROPIC_MODEL (or LITELLM_MODEL).
 *   bedrock  region-/inference-profile-specific, carrying an `anthropic.`
 *            (often `us.anthropic.…:0`) prefix — best-effort only, set
 *            ANTHROPIC_MODEL to your account's exact id.
 */
export function anthropicModel(): string {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  switch (anthropicBackend()) {
    case "bedrock":
      return "anthropic.claude-sonnet-4-6";
    case "litellm":
      return process.env.LITELLM_MODEL || "claude-sonnet-5";
    default:
      return "claude-sonnet-4-6";
  }
}

type AnyClient = Anthropic | AnthropicBedrock;
let client: AnyClient | null = null;

function getClient(): AnyClient {
  if (client) return client;
  const backend = anthropicBackend();

  if (backend === "litellm") {
    const key = process.env.LITELLM_API_KEY;
    if (!key) {
      throw new HttpError(
        500,
        "ai_provider_unconfigured",
        "Claude has no credentials. Set LITELLM_API_KEY to your LiteLLM virtual key in the API env and restart.",
      );
    }
    // LiteLLM exposes Anthropic's own /v1/messages surface, so the stock
    // SDK works unchanged against it — only the base URL and the key
    // change. The SDK sends the key as `x-api-key`; the Bearer header is
    // added because gateway deployments may read either one.
    client = new Anthropic({
      baseURL: litellmBaseUrl(),
      apiKey: key,
      defaultHeaders: { Authorization: `Bearer ${key}` },
    });
    return client;
  }

  if (backend === "bedrock") {
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
      "Claude has no credentials. Set ANTHROPIC_API_KEY, or point at the LiteLLM gateway with ANTHROPIC_BACKEND=litellm + LITELLM_API_KEY, in the API env and restart.",
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
  /**
   * Wall-clock budget for the round trip. Worth setting on any call that can
   * produce a long reply: without it the SDK waits far longer than the proxy
   * in front of this API will, and the caller is severed mid-flight with no
   * status and no message to show the user. Failing on OUR terms lets us say
   * something useful instead.
   */
  timeoutMs?: number;
}

/**
 * One non-streaming completion — used by chat + the two graders. The
 * grader prompts already instruct "return ONE JSON object, no prose"; the
 * caller parses `content` defensively. Thinking is left off (omitted) so
 * the model answers directly.
 */
export async function anthropicComplete(
  opts: CompleteInput,
): Promise<{
  content: string;
  model: string;
  usage: unknown;
  /**
   * Why the model stopped. `"max_tokens"` means the reply was CUT OFF, which
   * for a JSON-returning prompt yields a half-written object — surfaced so
   * callers can say "the answer was too long" instead of the much less useful
   * "that wasn't valid JSON".
   */
  stopReason: string | null;
}> {
  const c = getClient();
  let msg: Anthropic.Messages.Message;
  try {
    msg = await c.messages.create(
      {
        model: anthropicModel(),
        max_tokens: opts.maxTokens ?? 2048,
        ...(opts.system ? { system: opts.system } : {}),
        messages: opts.messages,
      },
      ...(opts.timeoutMs ? [{ timeout: opts.timeoutMs }] : []),
    );
  } catch (err) {
    throw mapSdkError(err);
  }
  return {
    content: textOf(msg.content),
    model: msg.model,
    usage: msg.usage,
    stopReason: msg.stop_reason ?? null,
  };
}

/**
 * Map SDK errors onto the same HttpError shape the OpenAI path uses.
 * Duck-typed on `.status` so it works for both the direct and Bedrock
 * SDK error classes.
 */
function mapSdkError(err: unknown): HttpError {
  // A timeout we imposed ourselves, not an upstream failure — the model was
  // still writing when we ran out of budget. Say what actually happened and
  // what to do about it, rather than reporting it as a provider error.
  const name = (err as { name?: unknown })?.name;
  if (name === "APIConnectionTimeoutError" || name === "AbortError") {
    return new HttpError(
      504,
      "ai_response_timeout",
      "That took too long to turn into a tracker. A shorter document — or just the part you actually want tracked — will come back quickly.",
    );
  }
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
