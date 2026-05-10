/**
 * Chat proxy — forwards conversation turns to the active AI provider's
 * OpenAI-compatible `/chat/completions` endpoint.
 *
 * The provider (Mistral, GLM/Z.ai, or OpenRouter) is selected by
 * `selectProvider()`, which reads — in order — the `x-ai-provider` request
 * header, the `provider` field on the body, the `AI_PROVIDER` env var,
 * then falls back to "mistral". API keys live server-side per provider:
 *
 *   .env.local
 *     MISTRAL_API_KEY=...     # required if AI_PROVIDER=mistral
 *     GLM_API_KEY=...         # required if AI_PROVIDER=glm
 *     OPENROUTER_API_KEY=...  # required if AI_PROVIDER=openrouter
 *     AI_PROVIDER=glm         # optional default override
 *
 * Client sends `{ messages: [{ role, content }], provider? }`. The
 * provider field on the body lets the dashboard remember the user's
 * pick in localStorage and ship it without env changes.
 */

import { selectProvider } from "@/lib/ai-providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYSTEM_PROMPT = [
  "You are the eSpace Dev Hub assistant — a calm, concise helper embedded",
  "in a personal engineering-performance dashboard. The dashboard pulls",
  "Jira, GitLab and GitHub data for one user, and is used to prep for",
  "performance reviews and 1:1s.",
  "",
  "Voice: measured, editorial, no hype. Short sentences. Prefer bullet",
  "lists for 3+ items. Don't add headings unless asked. Default to the",
  "user's terminology (PR / MR / ticket / review round / linkage).",
  "",
  "You are a chat assistant, not a data tool — you can't read the user's",
  "live Jira or GitLab data unless they paste it in. If they ask about",
  "their numbers, ask them to paste the snippet or point at the tile.",
].join("\n");

export async function POST(req) {
  let payload;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const provider = selectProvider({
    request: req,
    bodyProvider: payload?.provider,
  });
  if (!provider.apiKey) {
    return Response.json(
      {
        error: `${provider.label} has no API key. Set ${provider.keyEnv} in .env.local and restart the dev server.`,
      },
      { status: 500 },
    );
  }

  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  if (messages.length === 0) {
    return Response.json({ error: "No messages supplied." }, { status: 400 });
  }

  const clean = messages
    .map((m) => ({
      role: m?.role === "assistant" || m?.role === "user" ? m.role : null,
      content: typeof m?.content === "string" ? m.content : "",
    }))
    .filter((m) => m.role && m.content);

  const body = {
    model: provider.model,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...clean],
    temperature: 0.4,
  };

  let upstream;
  try {
    upstream = await fetch(provider.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...provider.extraHeaders,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return Response.json(
      { error: `Network error reaching ${provider.label}: ${err?.message || err}` },
      { status: 502 },
    );
  }

  const raw = await upstream.text();
  if (!upstream.ok) {
    return new Response(
      JSON.stringify({
        error: `${provider.label} ${upstream.status}: ${raw.slice(0, 500)}`,
      }),
      {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return Response.json(
      { error: `${provider.label} returned a non-JSON response.` },
      { status: 502 },
    );
  }

  const content = data?.choices?.[0]?.message?.content ?? "";
  return Response.json({
    content: content.trim(),
    model: data?.model,
    provider: provider.id,
    usage: data?.usage,
  });
}
