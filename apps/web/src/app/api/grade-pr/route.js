/**
 * AI grader — scores one PR against a user-supplied rubric.
 *
 * Contract (POST /api/grade-pr):
 *   Request:
 *     {
 *       pr: {
 *         id:       number | string,
 *         title:    string,
 *         body:     string,
 *         comments: [{ user, body, kind: "issue"|"review" }]
 *       },
 *       rubric: string[]   // user-defined criteria, all must pass
 *     }
 *   Response (200):
 *     {
 *       verdict: {
 *         pass:       boolean,
 *         reasoning:  string,   // one-line summary
 *         violations: string[]  // specific failing criteria (empty if pass)
 *       },
 *       model:    string,
 *       usage?:   object
 *     }
 *
 * Only the PR body and comments are sent to the model — never diffs,
 * never commit messages. The user's scope decision.
 *
 * The API key stays server-side. The route is stateless; caching happens
 * client-side in `grading-store` so different users on the same instance
 * never share verdicts.
 */

import { selectProvider } from "@/lib/ai-providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COMMENT_CHAR_LIMIT = 12000; // trim long threads defensively

const SYSTEM_PROMPT = [
  "You grade a single pull request against a user-defined rubric of quality",
  "criteria. The user is preparing performance-review evidence, so your",
  "grading must be fair, specific, and defensible.",
  "",
  "INPUT you receive:",
  "  - The PR title and body",
  "  - Every conversation + review comment on the PR",
  "  - A rubric: an array of short criterion strings",
  "",
  "TASK:",
  "  For EACH criterion, decide pass/fail based strictly on evidence in the",
  "  PR body or comments. Do not speculate beyond what's written.",
  "",
  "DECISION RULES:",
  "  - A criterion PASSES if nothing in the PR body or comments indicates a",
  "    violation of it.",
  "  - A criterion FAILS if a reviewer raised a concern that maps to it and",
  "    the concern was NOT resolved (no follow-up commit, no 'fixed', no",
  "    'addressed' reply from the author).",
  "  - The overall PR `pass` is TRUE iff all criteria pass.",
  "",
  "OUTPUT:",
  "  Return ONE JSON object, no prose, no markdown:",
  "  {",
  "    \"pass\":       <boolean>,",
  "    \"reasoning\":  <one sentence summary — what tipped the decision>,",
  "    \"violations\": [<one short string per failing criterion>]",
  "  }",
  "",
  "  `violations` must be empty when `pass` is true.",
  "  Keep each violation string under 140 chars.",
].join("\n");

function buildUserPrompt(pr, rubric) {
  const commentsTrimmed = (pr?.comments || [])
    .map((c) => `- [${c.kind}] ${c.user || "unknown"}: ${c.body || ""}`)
    .join("\n")
    .slice(0, COMMENT_CHAR_LIMIT);

  return [
    "Rubric (ALL criteria must pass):",
    ...rubric.map((r, i) => `  ${i + 1}. ${r}`),
    "",
    `PR title: ${pr?.title || ""}`,
    `PR body:`,
    (pr?.body || "").slice(0, 4000),
    "",
    "Comments:",
    commentsTrimmed || "(no comments)",
    "",
    "Grade this PR. Respond with a single JSON object.",
  ].join("\n");
}

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

  const { pr, rubric } = payload || {};
  if (!pr || typeof pr !== "object") {
    return Response.json({ error: "Missing `pr` object." }, { status: 400 });
  }
  if (!Array.isArray(rubric) || rubric.length === 0) {
    return Response.json(
      { error: "`rubric` must be a non-empty array of criterion strings." },
      { status: 400 },
    );
  }

  const cleanRubric = rubric
    .map((r) => (typeof r === "string" ? r.trim() : ""))
    .filter(Boolean);
  if (cleanRubric.length === 0) {
    return Response.json(
      { error: "Rubric contained no usable criteria after trimming." },
      { status: 400 },
    );
  }

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
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(pr, cleanRubric) },
        ],
      }),
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
      { error: `${provider.label} returned a non-JSON envelope.` },
      { status: 502 },
    );
  }

  const content = data?.choices?.[0]?.message?.content || "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return Response.json(
      { error: `${provider.label} returned non-JSON content: ${content.slice(0, 200)}` },
      { status: 502 },
    );
  }

  // Normalize the verdict defensively — the model is consistent with JSON
  // mode, but we still want a predictable shape downstream.
  const verdict = {
    pass: Boolean(parsed?.pass),
    reasoning:
      typeof parsed?.reasoning === "string" ? parsed.reasoning.trim() : "",
    violations: Array.isArray(parsed?.violations)
      ? parsed.violations
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean)
      : [],
  };

  return Response.json({
    verdict,
    model: data?.model,
    provider: provider.id,
    usage: data?.usage,
  });
}
