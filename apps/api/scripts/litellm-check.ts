/**
 * One-shot CLI: prove the Claude provider can actually reach its backend.
 *
 * Usage:
 *   npm run ai:check
 *
 * Optional:
 *   --models    also list what the gateway will route (LiteLLM only)
 *   --prompt=…  send your own text instead of the default ping
 *
 * Why this exists:
 *   Claude is reached through eSpace's LiteLLM gateway, which is only
 *   resolvable from inside the network. That means the migration cannot be
 *   verified from a laptop off-VPN, from CI, or from a sandboxed agent —
 *   the first real proof normally arrives as a 500 in front of a user
 *   mid-classification, with the failure buried under a generic
 *   "ai_provider_error".
 *
 *   This script moves that discovery forward. It resolves config exactly
 *   the way the running service does — same `anthropicBackend()`, same
 *   `anthropicModel()`, same client, same `anthropicComplete()` call path
 *   — so a pass here means the service's Claude path works, not merely
 *   that the host is pingable.
 *
 * Exit codes: 0 on a successful completion, 1 on any failure.
 */

// The provider module reaches the shared error handler, which pulls in the
// env schema and aborts the process when the service-level vars are
// missing. Nothing here touches Mongo or sessions, and the point of the
// script is to be runnable in a bare shell, so satisfy the schema with
// placeholders and import dynamically, after they are set. In the deployed
// container the real values are already present and these no-op.
process.env.MONGO_URI ??= "mongodb://localhost:27017";
process.env.SESSION_SECRET ??= "litellm-check-placeholder-000000000000";
process.env.INTEGRATION_TOKEN_KEY ??= "litellm-check-placeholder-00000000000";

const { resolveAnthropicBackend, anthropicModel, anthropicComplete } =
  await import("../src/modules/ai/anthropic.js");

const args = process.argv.slice(2);
const wantModels = args.includes("--models");
const promptArg = args.find((a) => a.startsWith("--prompt="));
const prompt = promptArg
  ? promptArg.slice("--prompt=".length)
  : "Reply with exactly: OK";

/** Never print a key. Enough to tell "wrong key" from "no key". */
function mask(key: string | undefined): string {
  if (!key) return "(unset)";
  return key.length <= 8
    ? `${key.slice(0, 2)}…(${key.length} chars)`
    : `${key.slice(0, 5)}…${key.slice(-2)} (${key.length} chars)`;
}

function baseUrl(): string {
  const raw = (process.env.LITELLM_BASE_URL || "https://litellm.espace.ws").trim();
  return raw.replace(/\/+$/, "").replace(/\/v1$/, "");
}

const resolved = resolveAnthropicBackend();
const backend = resolved.backend;
const model = anthropicModel();

console.log("resolved config");
console.log(`  backend   ${backend}`);
console.log(`  chosen by ${resolved.source}`);
console.log(`  model     ${model}`);
if (backend === "litellm") {
  console.log(`  base url  ${baseUrl()}`);
  console.log(`  key       ${mask(process.env.LITELLM_API_KEY)}`);
} else if (backend === "direct") {
  console.log(`  key       ${mask(process.env.ANTHROPIC_API_KEY)}`);
} else {
  console.log(`  region    ${process.env.AWS_REGION || "us-east-1 (default)"}`);
  console.log("  NOTE      direct Bedrock is being retired — see ANTHROPIC_BACKEND");
}
console.log("");

/**
 * The gateway's model list. Worth fetching on failure specifically: a
 * wrong model name and a wrong key both surface as an opaque 4xx on the
 * completion, and seeing the routable names side by side settles which one
 * it was in a glance.
 */
async function listModels(): Promise<string[] | null> {
  const key = process.env.LITELLM_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${baseUrl()}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
  } catch {
    return null;
  }
}

if (wantModels && backend === "litellm") {
  const models = await listModels();
  console.log(
    models
      ? `gateway routes ${models.length} model(s):\n  ${models.join("\n  ")}\n`
      : "could not list models — the completion below will say why\n",
  );
}

console.log(`sending a test completion to ${backend}…`);
try {
  const r = await anthropicComplete({
    messages: [{ role: "user", content: prompt }],
    maxTokens: 64,
    timeoutMs: 30_000,
  });
  console.log("");
  console.log("OK — the Claude path works.");
  console.log(`  replied     ${JSON.stringify(r.content)}`);
  console.log(`  model       ${r.model}`);
  console.log(`  stop reason ${r.stopReason ?? "(none)"}`);
  console.log(`  usage       ${JSON.stringify(r.usage)}`);
  process.exit(0);
} catch (err) {
  const status = (err as { status?: unknown })?.status;
  const message = err instanceof Error ? err.message : String(err);
  console.error("");
  console.error(`FAILED — ${message}`);

  // Turn the raw status into the specific thing to go change. Each of
  // these is a distinct fix, and the status alone does not name it.
  if (backend === "litellm") {
    // A 403 is ambiguous: it can come from the gateway (key revoked or out
    // of scope) OR from a proxy/WAF between here and it, which never let
    // the request through at all. Blaming the key for a network denial
    // sends people to rotate a perfectly good key, so split on the body.
    const blockedByIntermediary =
      status === 403 && /allowlist|egress|forbidden by proxy|tunnel/i.test(message);

    if (blockedByIntermediary) {
      console.error(
        `\nThis was blocked BEFORE it reached the gateway — the message above\n` +
          `came from a proxy, not from LiteLLM. The key is not implicated.\n` +
          `Allow egress to ${new URL(baseUrl()).host}, or run this from a\n` +
          `host that already has it (the API container, or on VPN).`,
      );
    } else if (status === 401 || status === 403) {
      console.error(
        "\nThe gateway rejected the key. Check LITELLM_API_KEY against the\n" +
          "Virtual Keys page in the LiteLLM UI — a rotated or revoked key\n" +
          "fails exactly like this.",
      );
    } else if (status === 404) {
      console.error(
        `\n404 usually means the base URL is wrong, not the key. It must be\n` +
          `the origin with NO trailing /v1 — the SDK appends /v1/messages\n` +
          `itself. Currently resolving to: ${baseUrl()}`,
      );
    } else if (status === 400) {
      const models = await listModels();
      console.error(
        `\n400 on a well-formed request usually means the model name is not\n` +
          `routable on this gateway. Trying: ${model}`,
      );
      if (models?.length) {
        console.error(`\nThe gateway routes:\n  ${models.join("\n  ")}`);
        console.error(`\nSet ANTHROPIC_MODEL to one of those.`);
      }
    } else if (status === undefined) {
      console.error(
        `\nNo HTTP status came back, so this did not reach the gateway.\n` +
          `${baseUrl()} resolves only inside the eSpace network — check the\n` +
          `VPN, or that the container has egress to it.`,
      );
    }
  }
  process.exit(1);
}
