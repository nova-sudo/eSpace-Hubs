/**
 * Backend resolution for the Claude provider. The interesting cases are all
 * about the LiteLLM migration: the gateway is the default, but environments
 * that still carry the old ANTHROPIC_BEDROCK flag or a bare direct key must
 * keep resolving the way they did before they were migrated.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// anthropic.ts reaches the shared error handler, which pulls in the env
// schema and aborts the process when the service-level vars are missing.
// Nothing under test touches them, so satisfy the schema with placeholders
// and import dynamically, after they are set.
process.env.MONGO_URI ??= "mongodb://localhost:27017";
process.env.SESSION_SECRET ??= "test-session-secret-0000000000000000";
process.env.INTEGRATION_TOKEN_KEY ??= "test-integration-key-000000000000000";

const { anthropicBackend, anthropicModel } = await import("./anthropic.js");

const KEYS = [
  "ANTHROPIC_BACKEND",
  "ANTHROPIC_BEDROCK",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "LITELLM_API_KEY",
  "LITELLM_MODEL",
] as const;

/** Run `fn` with exactly `env` set on the relevant keys, then restore. */
function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void) {
  const saved = new Map(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("defaults to the LiteLLM gateway", () => {
  withEnv({}, () => assert.equal(anthropicBackend(), "litellm"));
  withEnv({ LITELLM_API_KEY: "sk-x" }, () =>
    assert.equal(anthropicBackend(), "litellm"),
  );
});

test("ANTHROPIC_BACKEND wins over every fallback", () => {
  withEnv({ ANTHROPIC_BACKEND: "direct", LITELLM_API_KEY: "sk-x" }, () =>
    assert.equal(anthropicBackend(), "direct"),
  );
  withEnv({ ANTHROPIC_BACKEND: " LiteLLM ", ANTHROPIC_BEDROCK: "1" }, () =>
    assert.equal(anthropicBackend(), "litellm"),
  );
  withEnv({ ANTHROPIC_BACKEND: "bedrock" }, () =>
    assert.equal(anthropicBackend(), "bedrock"),
  );
});

test("an unrecognised ANTHROPIC_BACKEND falls through, it does not throw", () => {
  withEnv({ ANTHROPIC_BACKEND: "sagemaker" }, () =>
    assert.equal(anthropicBackend(), "litellm"),
  );
});

test("legacy ANTHROPIC_BEDROCK=1 still selects bedrock", () => {
  for (const v of ["1", "true", "YES"]) {
    withEnv({ ANTHROPIC_BEDROCK: v }, () =>
      assert.equal(anthropicBackend(), "bedrock"),
    );
  }
  withEnv({ ANTHROPIC_BEDROCK: "0" }, () =>
    assert.equal(anthropicBackend(), "litellm"),
  );
});

test("a lone direct key keeps an unmigrated env on api.anthropic.com", () => {
  withEnv({ ANTHROPIC_API_KEY: "sk-ant-x" }, () =>
    assert.equal(anthropicBackend(), "direct"),
  );
  // …but once a gateway key is present, the gateway wins.
  withEnv({ ANTHROPIC_API_KEY: "sk-ant-x", LITELLM_API_KEY: "sk-x" }, () =>
    assert.equal(anthropicBackend(), "litellm"),
  );
});

test("model id follows the backend, and ANTHROPIC_MODEL always wins", () => {
  // Gateway default is the alias LiteLLM publishes, not an Anthropic id.
  withEnv({}, () => assert.equal(anthropicModel(), "claude-sonnet-5"));
  withEnv({ ANTHROPIC_BACKEND: "direct" }, () =>
    assert.equal(anthropicModel(), "claude-sonnet-4-6"),
  );
  withEnv({ ANTHROPIC_BEDROCK: "1" }, () =>
    assert.equal(anthropicModel(), "anthropic.claude-sonnet-4-6"),
  );
  withEnv({ LITELLM_MODEL: "claude-opus-5" }, () =>
    assert.equal(anthropicModel(), "claude-opus-5"),
  );
  withEnv({ LITELLM_MODEL: "claude-opus-5", ANTHROPIC_MODEL: "pinned" }, () =>
    assert.equal(anthropicModel(), "pinned"),
  );
});
