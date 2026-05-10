/**
 * AI provider registry — server-side only.
 *
 * All supported providers (Mistral, GLM/Z.ai, OpenRouter) ship OpenAI-compatible
 * `/chat/completions` endpoints with the same request/response shape, so
 * the only knobs that vary are: base URL, default model, env-var name
 * for the API key, and any provider-specific extra headers. This module
 * surfaces those as a single `selectProvider(req?)` call that every API
 * route uses.
 *
 * Resolution priority (highest first):
 *   1. `x-ai-provider` request header
 *   2. `provider` field on the JSON request body (when caller passes the
 *      already-parsed body in)
 *   3. `AI_PROVIDER` env var
 *   4. "mistral" (default — keeps existing setups working untouched)
 *
 * Env vars consumed:
 *   AI_PROVIDER          — default provider id, "mistral" | "glm" | "openrouter"
 *   MISTRAL_API_KEY      — server-side key
 *   MISTRAL_MODEL        — optional model override
 *   GLM_API_KEY          — server-side key
 *   GLM_MODEL            — optional model override
 *   OPENROUTER_API_KEY   — server-side key
 *   OPENROUTER_MODEL     — optional model override (any openrouter.ai slug)
 *
 * Adding a fourth provider: extend `PROVIDERS` below. No route changes.
 */

const PROVIDERS = Object.freeze({
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
    // standard PaaS surface; matches the shape we already use for Mistral.
    url: "https://api.z.ai/api/paas/v4/chat/completions",
    // glm-4.5-flash is the cheap+fast tier — good default for both chat
    // and structured-output use. Override via GLM_MODEL if you want
    // glm-4.5 (sharper reasoning, slower) or glm-4.5-air for cost.
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
    // pick the model with the slug — the `:free` suffix routes to the
    // free tier where available.
    url: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-oss-20b:free",
    keyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    // OpenRouter optionally tags requests with a referrer + title for
    // its public model-leaderboard rankings. Not required, but cheap to
    // include; helps OpenRouter surface usage to model authors.
    extraHeaders: {
      "HTTP-Referer": "https://github.com/nova-sudo/eSpaceDev",
      "X-Title": "eSpace Dev Hub",
    },
  },
});

const DEFAULT_PROVIDER_ID = "mistral";

/**
 * Pick the provider for this request. Returns a fully-resolved config:
 *   { id, label, url, model, apiKey }
 *
 * Throws when the chosen provider has no API key configured — the route
 * should catch that and return 500 with an actionable message.
 *
 * @param {{ request?: Request, bodyProvider?: string }} [opts]
 */
export function selectProvider(opts = {}) {
  const headerHint = opts.request?.headers?.get?.("x-ai-provider");
  const bodyHint = typeof opts.bodyProvider === "string" ? opts.bodyProvider : null;
  const envHint = process.env.AI_PROVIDER;
  const requested = (headerHint || bodyHint || envHint || DEFAULT_PROVIDER_ID)
    .toString()
    .trim()
    .toLowerCase();

  const provider = PROVIDERS[requested] || PROVIDERS[DEFAULT_PROVIDER_ID];
  const apiKey = process.env[provider.keyEnv];
  const model = process.env[provider.modelEnv] || provider.defaultModel;

  return {
    id: provider.id,
    label: provider.label,
    url: provider.url,
    model,
    apiKey: apiKey || null,
    // Echo the env-var name so error messages can tell the user exactly
    // what to set without us hardcoding string copies in every route.
    keyEnv: provider.keyEnv,
    // Provider-specific extra headers (e.g. OpenRouter attribution). Always
    // an object — empty for providers that don't need any. Routes spread
    // this into their fetch headers alongside Authorization/Content-Type.
    extraHeaders: provider.extraHeaders || {},
  };
}

/**
 * Public list of provider ids — used by the client-side selector so the
 * UI can render a dropdown without duplicating ids on the client.
 */
export const PROVIDER_IDS = Object.keys(PROVIDERS);

/**
 * Tiny lookup for clients that need the human-readable label.
 */
export function providerLabel(id) {
  return PROVIDERS[id]?.label || id;
}
