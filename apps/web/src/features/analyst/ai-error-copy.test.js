import test from "node:test";
import assert from "node:assert/strict";
import { AI_UNCONFIGURED_COPY, aiErrorMessage } from "./ai-error-copy.js";

test("aiErrorMessage: the unconfigured code maps to the plain sentence", () => {
  assert.equal(aiErrorMessage({ code: "ai_provider_unconfigured", message: "x" }), AI_UNCONFIGURED_COPY);
});

test("aiErrorMessage: env-var operator copy never reaches the user", () => {
  const raw =
    "Claude has no credentials. Set ANTHROPIC_API_KEY, or point at the LiteLLM gateway with ANTHROPIC_BACKEND=litellm + LITELLM_API_KEY, in the API env and restart.";
  assert.equal(aiErrorMessage(raw), AI_UNCONFIGURED_COPY);
  assert.equal(aiErrorMessage({ message: "Mistral has no API key. Set MISTRAL_API_KEY in apps/api/.env.local and restart." }), AI_UNCONFIGURED_COPY);
});

test("aiErrorMessage: other errors pass through, empty falls back", () => {
  assert.equal(aiErrorMessage("Rate limited — try again in a minute."), "Rate limited — try again in a minute.");
  assert.equal(aiErrorMessage(null, "fallback"), "fallback");
});
