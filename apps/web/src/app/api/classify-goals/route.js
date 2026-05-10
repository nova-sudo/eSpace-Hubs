/**
 * POST /api/classify-goals
 *
 * Streams AnalysisEvents as NDJSON (newline-delimited JSON) so the browser
 * can render each event as it arrives without buffering.
 *
 * Request:
 *   { goals: [{ id, title, description?, parentL1Title?, kind: "L1"|"L2" }] }
 *
 * Response:
 *   Content-Type: application/x-ndjson
 *   One JSON object per line. Each line is an AnalysisEvent
 *   ({type, payload}) from analysis-events.js.
 *
 * The route itself is thin: parse body, build the default classifier, pipe
 * the async-iterable into a ReadableStream. All adapter logic lives in the
 * feature.
 */

import { createDefaultClassifier } from "@/features/analyst/ai/classifier-index";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeGoals(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => {
      if (!g || typeof g !== "object") return null;
      if (typeof g.id !== "string" || !g.id.trim()) return null;
      if (typeof g.title !== "string" || !g.title.trim()) return null;
      return {
        id: g.id.trim(),
        title: g.title.trim(),
        description:
          typeof g.description === "string" ? g.description.trim() : undefined,
        parentL1Title:
          typeof g.parentL1Title === "string"
            ? g.parentL1Title.trim()
            : undefined,
        kind: g.kind === "L1" || g.kind === "L2" ? g.kind : "L1",
      };
    })
    .filter(Boolean);
}

export async function POST(req) {
  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonError(400, "Malformed JSON body.");
  }

  const goals = normalizeGoals(payload?.goals);
  if (goals.length === 0) {
    return jsonError(400, "No goals supplied (expected `goals: [...]`).");
  }

  let classifier;
  try {
    classifier = createDefaultClassifier({
      request: req,
      bodyProvider: payload?.provider,
    });
  } catch (err) {
    return jsonError(500, err?.message || "Classifier misconfigured.");
  }

  const encoder = new TextEncoder();
  const abortController = new AbortController();

  // When the client disconnects, Next.js aborts the request signal — forward
  // to the classifier so in-flight Mistral calls cancel.
  req.signal?.addEventListener?.("abort", () => abortController.abort());

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of classifier.classify(goals, {
          signal: abortController.signal,
        })) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (err) {
        // Emergency envelope so the UI doesn't hang on a mid-stream error.
        const errEvt = {
          type: "analysis:error",
          payload: { error: err?.message || String(err) },
        };
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(errEvt)}\n`));
        } catch {
          /* noop — controller may already be closed */
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
