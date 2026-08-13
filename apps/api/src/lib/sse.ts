/**
 * Server-sent events for long single-answer requests.
 *
 * The problem this solves is not incremental rendering — it is survival.
 * A reverse proxy severs a response that produces no bytes for ~30s, and
 * it does so without a status code: the client sees a dead socket, the
 * server logs `request aborted`, and neither end learns anything. Any
 * request whose useful work outlasts that window needs to say something
 * before it finishes, even if it has nothing to say yet.
 *
 * So this is deliberately NOT a token-streaming abstraction. The payload
 * still arrives once, whole, in a single `result` event, which means all
 * the server-side parsing, validation and repair that runs after the model
 * replies stays exactly where it is. What changes is that the connection
 * is provably alive the entire time.
 *
 * Wire format (standard SSE, readable by EventSource or a fetch reader):
 *
 *   : open                     ← sent immediately, starts the byte flow
 *   event: progress            ← liveness; `chars` is best-effort
 *   data: {"chars":128}
 *
 *   event: result              ← the response body, once
 *   data: {...}
 *
 *   event: error               ← failure AFTER headers went out
 *   data: {"error":"…","message":"…"}
 *
 * An error before the first byte is NOT sent here — the normal error
 * handler still owns that case, and can still set a real status code.
 * Once `open()` is called that option is gone, which is why it takes an
 * explicit call rather than happening in the constructor.
 */

import type { Response } from "express";

/** How often to emit a keepalive when nothing else is flowing. */
const HEARTBEAT_MS = 5_000;

export interface SseChannel {
  /** True once headers have been flushed and a status can no longer be set. */
  readonly open: boolean;
  /** Note progress. Cheap and idempotent — safe to call per token. */
  tick(chars?: number): void;
  /** Send the final payload and end the response. */
  result(body: unknown): void;
  /** Report a failure that happened after headers went out, and end. */
  fail(code: string, message: string): void;
}

/** Does this request want events rather than a single JSON body? */
export function wantsSse(accept: string | undefined): boolean {
  return typeof accept === "string" && accept.includes("text/event-stream");
}

export function openSse(res: Response): SseChannel {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Nginx buffers proxied responses by default, which would hold every
    // event until the end and defeat the entire point. Harmless elsewhere.
    "X-Accel-Buffering": "no",
  });

  // The opening comment is the important byte. It is what tells every hop
  // in the path that this response has started, before any work happens.
  res.write(": open\n\n");
  res.flushHeaders?.();

  let ended = false;
  let pending = 0;

  const send = (event: string, data: unknown): void => {
    if (ended) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Fires regardless of whether the upstream produces deltas, so providers
  // with no streaming support are covered by the same mechanism.
  const heartbeat = setInterval(() => {
    if (ended) return;
    send("progress", { chars: pending });
  }, HEARTBEAT_MS);
  // Never hold the process open for a keepalive.
  heartbeat.unref?.();

  const stop = (): void => {
    ended = true;
    clearInterval(heartbeat);
  };

  // A client that navigates away should not keep the interval alive.
  res.on("close", stop);

  return {
    get open() {
      return true;
    },
    tick(chars = 0) {
      pending += chars;
    },
    result(body) {
      if (ended) return;
      send("result", body);
      stop();
      res.end();
    },
    fail(code, message) {
      if (ended) return;
      send("error", { error: code, message });
      stop();
      res.end();
    },
  };
}
