/**
 * /api/v1/ai/classify-goals — streaming NDJSON endpoint.
 *
 * Ports apps/web/src/app/api/classify-goals/route.js to Express. The
 * Web Streams `ReadableStream` controller pattern in the original
 * doesn't apply here; instead we drive `res.write()` from a `for await`
 * loop over the classifier's AsyncGenerator.
 *
 * Wire format:
 *   Content-Type: application/x-ndjson; charset=utf-8
 *   One JSON object per line (`AnalysisEvent`).
 *   Connection stays open until the classifier finishes OR the client
 *   disconnects.
 *
 * Abort propagation:
 *   When the client closes the connection, Express fires `req.on('close')`
 *   while res isn't writable. We abort the AbortController which the
 *   classifier honours — every in-flight Mistral fetch sees its
 *   `signal.aborted = true` and tears down.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { logger } from "../../lib/logger.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  AnalysisEvents,
  createDefaultClassifier,
  type AnalysisEvent,
  type GoalForClassification,
} from "./classifier/index.js";

// ─── input schema ────────────────────────────────────────────────────

const classifyGoalsSchema = z.object({
  goals: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        title: z.string().min(1).max(500),
        description: z.string().max(8_000).optional(),
        parentL1Title: z.string().max(500).optional(),
        kind: z.enum(["L1", "L2"]).default("L1"),
      }),
    )
    .min(1)
    .max(100),
  provider: z.string().min(2).max(40).optional(),
});

// ─── handler ─────────────────────────────────────────────────────────

export async function classifyGoalsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Validate BEFORE opening the stream — invalid payloads should look
  // like ordinary 400s (the global error handler will JSON-shape them),
  // not partial NDJSON streams.
  let parsed;
  try {
    if (!req.session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }
    parsed = classifyGoalsSchema.parse(req.body);
  } catch (err) {
    return next(err);
  }

  let classifier;
  try {
    classifier = createDefaultClassifier({
      request: req,
      bodyProvider: parsed.provider ?? null,
    });
  } catch (err) {
    return next(
      new HttpError(
        500,
        "ai_provider_unconfigured",
        err instanceof Error ? err.message : String(err),
      ),
    );
  }

  // Past this point we OWN the response — write the NDJSON headers and
  // never call next(err) (the body has already started, the client
  // would get a half-stream + appended JSON envelope which our error
  // handler can't deliver).
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  // Disable nginx-style buffering — the analyst UI needs each line as
  // soon as it's emitted.
  res.setHeader("X-Accel-Buffering", "no");
  // Flush headers immediately so the client opens the stream.
  res.flushHeaders?.();

  const abortController = new AbortController();
  const goals: GoalForClassification[] = parsed.goals.map((g) => ({
    id: g.id.trim(),
    title: g.title.trim(),
    ...(g.description ? { description: g.description.trim() } : {}),
    ...(g.parentL1Title
      ? { parentL1Title: g.parentL1Title.trim() }
      : {}),
    kind: g.kind,
  }));

  // Client disconnect → abort the classifier so in-flight fetches stop.
  req.on("close", () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  /** Best-effort write — backpressure ignored intentionally. NDJSON
   *  events are tiny (kilobytes at most). If the socket buffer fills,
   *  Node will queue and eventually drain; if the client has gone away,
   *  the close handler will abort the classifier shortly after. */
  const writeEvent = (event: AnalysisEvent): boolean => {
    if (res.writableEnded) return false;
    try {
      return res.write(`${JSON.stringify(event)}\n`);
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          reqId: req.id,
        },
        "[classify] write failed",
      );
      return false;
    }
  };

  // NOTE on perceived latency: the client (see use-classify-goals.js)
  // seeds its `events` state with a synthetic START on click, which
  // immediately shows "0 / N · analyzing · 0s" in the summary strip.
  // We deliberately do NOT emit a duplicate START from the server here
  // — an earlier attempt did, and it appeared to interact badly with
  // the per-goal streaming loop (the response would deliver the START
  // chunk and then stall before yielding the classifier's own events).
  // The classifier emits its own START as the first event from
  // `classify()`, which is sufficient and arrives before any goal-
  // specific events.
  try {
    for await (const event of classifier.classify(goals, {
      signal: abortController.signal,
    })) {
      if (!writeEvent(event)) break;
    }
  } catch (err) {
    // Mid-stream catastrophe — emit one final ERROR envelope so the UI
    // doesn't hang waiting for COMPLETE.
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        reqId: req.id,
      },
      "[classify] mid-stream error",
    );
    writeEvent(
      AnalysisEvents.error({
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}
