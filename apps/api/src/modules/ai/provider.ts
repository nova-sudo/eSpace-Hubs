/**
 * AI provider registry — server-side only.
 *
 * All supported providers (Mistral, GLM/Z.ai, OpenRouter) ship
 * OpenAI-compatible /chat/completions endpoints with the same request +
 * response shape, so the only knobs that vary are: base URL, default
 * model, env-var name for the API key, and any provider-specific extra
 * headers. selectProvider() resolves these from the request + env into
 * one ready-to-use config.
 *
 * Resolution priority (highest first):
 *   1. `x-ai-provider` request header
 *   2. `provider` field in the JSON body (when caller passes the
 *      already-parsed body in)
 *   3. `AI_PROVIDER` env var
 *   4. "mistral" (default)
 *
 * Env vars consumed:
 *   AI_PROVIDER          default provider id
 *   MISTRAL_API_KEY      server-side key
 *   MISTRAL_MODEL        optional model override
 *   GLM_API_KEY          server-side key
 *   GLM_MODEL            optional model override
 *   OPENROUTER_API_KEY   server-side key
 *   OPENROUTER_MODEL     optional model override (any openrouter.ai slug)
 *
 * Adding a fourth provider: extend `PROVIDERS` below — no controller
 * changes required.
 *
 * Ported from apps/web/src/lib/ai-providers.js as part of M3 — the
 * frontend's selector + the API service share the SAME registry shape
 * so the UI dropdown stays in sync.
 */

import type { Request } from "express";

interface ProviderDef {
  id: string;
  label: string;
  url: string;
  defaultModel: string;
  keyEnv: string;
  modelEnv: string;
  extraHeaders: Record<string, string>;
}

const PROVIDERS: Record<string, ProviderDef> = Object.freeze({
  mistral: {
    id: "mistral",
    label: "Mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    defaultModel: "mistral-medium-latest",
    keyEnv: "MISTRAL_API_KEY",
    modelEnv: "MISTRAL_MODEL",
    extraHeaders: {},
  },
  glm: {
    id: "glm",
    label: "GLM (Z.ai)",
    // OpenAI-compatible Z.ai endpoint. Their docs describe this as the
    // standard PaaS surface; matches the shape we use for Mistral.
    url: "https://api.z.ai/api/paas/v4/chat/completions",
    // glm-4.5-flash is the cheap+fast tier — good default for chat AND
    // structured output. Override via GLM_MODEL for glm-4.5 (sharper
    // reasoning, slower) or glm-4.5-air (cost-optimised).
    defaultModel: "glm-4.5-flash",
    keyEnv: "GLM_API_KEY",
    modelEnv: "GLM_MODEL",
    extraHeaders: {},
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    // OpenRouter is a single OpenAI-compatible gateway across many model
    // hosts (Anthropic, Mistral, Qwen, DeepSeek, …). One key, one URL,
    // pick the model with the slug — `:free` suffix routes to free tier
    // where available.
    url: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-oss-20b:free",
    keyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    // OpenRouter optionally tags requests with a referrer + title for
    // its public model-leaderboard rankings. Not required, but cheap
    // to include.
    extraHeaders: {
      "HTTP-Referer": "https://github.com/nova-sudo/eSpaceDev",
      "X-Title": "eSpace Dev Hub",
    },
  },
});

const DEFAULT_PROVIDER_ID = "mistral";

export interface ResolvedProvider {
  id: string;
  label: string;
  url: string;
  model: string;
  /** null when the env var is not set — caller surfaces 500 to the user. */
  apiKey: string | null;
  /** Echoed so error messages can name the missing env var explicitly. */
  keyEnv: string;
  extraHeaders: Record<string, string>;
}

interface SelectInput {
  request?: Request;
  bodyProvider?: string | null;
}

/**
 * Resolve the requested provider id (header → body → env → default),
 * lower-cased. Exported so non-OpenAI providers (Anthropic, which uses
 * its own SDK rather than the OpenAI-compatible `selectProvider` path)
 * can branch on the same resolution before `selectProvider` runs.
 */
export function resolveRequestedId(opts: SelectInput = {}): string {
  const headerHint = opts.request?.header?.("x-ai-provider");
  const bodyHint =
    typeof opts.bodyProvider === "string" ? opts.bodyProvider : null;
  const envHint = process.env.AI_PROVIDER;
  return String(headerHint || bodyHint || envHint || DEFAULT_PROVIDER_ID)
    .trim()
    .toLowerCase();
}

export function selectProvider(opts: SelectInput = {}): ResolvedProvider {
  const requested = resolveRequestedId(opts);

  const provider =
    PROVIDERS[requested] ||
    (PROVIDERS[DEFAULT_PROVIDER_ID] as ProviderDef);
  const apiKey = process.env[provider.keyEnv] ?? null;
  const model = process.env[provider.modelEnv] || provider.defaultModel;

  return {
    id: provider.id,
    label: provider.label,
    url: provider.url,
    model,
    apiKey,
    keyEnv: provider.keyEnv,
    extraHeaders: provider.extraHeaders,
  };
}

export const PROVIDER_IDS = Object.keys(PROVIDERS);

export function providerLabel(id: string): string {
  return PROVIDERS[id]?.label ?? id;
}
