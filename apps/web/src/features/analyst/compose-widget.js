"use client";

/**
 * "Describe your own tracker" → a COMPOSED widget spec.
 *
 * The classifier can't always find a good widget for a fuzzy goal (e.g. "read
 * 5 chapters every quarter" mis-modelled as a static Q1–Q4 checklist). This is
 * the manual escape hatch: the user describes, in plain English, how they want
 * to track the goal, and the server turns it into a COMPOSED spec (fields +
 * optional cadence + tiers) validated through the shared spec builder.
 *
 * Thin promise-returning helper — same shape as `reclassifyOneGoal`. Reads the
 * active AI provider and POSTs to /api/v1/ai/compose-widget; resolves with the
 * validated spec the caller then saves.
 *
 * Documents (Phase 1). A user who already has a plan document shouldn't have to
 * retype it into a 2,000-character box, so `extractComposeAttachment` uploads
 * the file and gets plain text back — a *separate* round-trip from the compose
 * call on purpose. Extraction is deterministic, free, and fails in ways a text
 * POST never does (scanned PDF, encrypted, corrupt); splitting it means those
 * failures land before an LLM call is spent, and the user gets to read and fix
 * the extracted text before it's sent anywhere. The server never keeps the
 * bytes, so the text we hold in React state is the only copy that survives.
 *
 * Automatic fields. A returned spec may contain fields carrying a `source` — an
 * allow-listed query the server resolves against the user's GitHub/GitLab, so
 * the field fills itself and renders read-only. Nothing extra crosses the wire
 * for it: the source rides inside `spec.fields[]`, and the questions it needs
 * answered ride in `spec.context`, both of which the caller already receives.
 * That is deliberate — a parallel channel would be a second place for the two
 * halves to disagree about which answer feeds which query.
 *
 * Note the two different transports below: compose is JSON via raw fetch (it
 * needs the `x-ai-provider` header), extraction is multipart via `apiPost`'s
 * `init.body` escape hatch. FormData MUST NOT carry a hand-set Content-Type —
 * only the browser knows the multipart boundary it generated — which is exactly
 * why the request goes through `init` rather than api-client's JSON body path.
 */

import { apiPost } from "@/lib/api-client";
import { getAiProvider } from "./use-ai-provider";

/** Mirrors the server's multer limit — reject locally before wasting an upload. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Mirrors the server's allow-list. Also the `accept` value for the file input. */
export const ATTACHMENT_ACCEPT = ".pdf,.docx,.xlsx,.xls,.csv";

/**
 * Mirrors the server's extracted-text cap. The server re-truncates whatever we
 * send (it can't trust a client-supplied length), so this is purely about not
 * shipping megabytes of text the API would only throw away.
 */
export const ATTACHMENT_MAX_CHARS = 20_000;

/**
 * Extraction failures the user can actually act on. The API returns a code and
 * a generic message (raw parser exceptions never cross the wire); we translate
 * the code into copy that names the likely cause and a way forward, because
 * "extract_failed" tells a user nothing about their scanned PDF.
 */
const EXTRACT_ERROR_COPY = {
  unsupported_file_type:
    "We can only read PDF, DOCX, XLSX, XLS and CSV files. Export it as one of those, or just describe the plan below.",
  file_too_large: "That file is over 10 MB. Try a smaller export.",
  extract_failed:
    "We couldn't read any text from this document — it may be scanned, password-protected or corrupt. Try a text-based export, or describe it below.",
  extract_timeout:
    "That document took too long to read, so we stopped. Try a smaller or simpler file.",
  rate_limited:
    "That's a lot of documents in a short window. Wait a few minutes and try again.",
};

export async function composeWidget({
  goalId,
  goalTitle,
  description,
  attachment,
  signal,
}) {
  if (!goalId) throw new Error("composeWidget: goalId is required");
  const desc = typeof description === "string" ? description.trim() : "";
  if (desc.length < 3) throw new Error("Describe how you want to track this goal.");

  const provider = getAiProvider();
  const attached = normalizeAttachment(attachment);
  const res = await fetch("/api/v1/ai/compose-widget", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-ai-provider": provider,
      // Ask for events, not a single body. Compose routinely runs past the
      // ~30s a proxy will hold a silent response open, and being severed
      // yields no status and no message — the request just dies. A stream
      // emits from the first millisecond, so the connection stays provably
      // alive for as long as the work takes. The payload is unchanged; it
      // arrives whole, in one `result` event.
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      goalId,
      goalTitle: goalTitle || "",
      description: desc,
      // Kept separate from `description` so the 2,000-char cap keeps meaning
      // "what the user typed" and document bulk gets its own budget.
      ...(attached ? { attachment: attached } : {}),
      provider,
    }),
    signal,
  });

  // The server honours the Accept header, but a cached bundle or an older
  // deployment can still answer with plain JSON — read whichever arrived
  // rather than assuming, so a version skew degrades instead of breaking.
  const body = res.headers.get("content-type")?.includes("text/event-stream")
    ? await readSseResult(res)
    : await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      body?.error?.message || body?.error || `Couldn't build a tracker (${res.status}).`,
    );
  }
  // An SSE response is always HTTP 200 — the status line is sent before the
  // work starts — so an in-band failure has to be checked separately.
  if (body?.__sseError) {
    throw new Error(body.message || "Couldn't build a tracker.");
  }
  if (!body?.spec) throw new Error("The AI returned no tracker — try rephrasing.");
  // `seeded: true` means the model's field list was unusable and the server
  // fell back to a generic tracker — surfaced so the UI can hint at it.
  // `unrepresented` is the document-aware sibling of that signal: parts of the
  // source one tracker couldn't carry. Per-period content now survives via
  // `composed.periods`, so this list should be shorter than it was — what
  // remains is genuinely out of scope (a weighted metrics table needs its own
  // tier ladder; a risk register isn't a metric). It keeps that loss visible
  // rather than silent — and now also carries fields that ASKED to be automatic
  // but whose query the server refused, which degrade to typed fields. Same
  // channel on purpose: to the user both are "this tracker is weaker than you
  // described", and one banner they read beats two they learn to skip.
  return {
    spec: body.spec,
    seeded: body.seeded === true,
    unrepresented: toStringList(body.unrepresented),
  };
}

/**
 * Upload one document, get plain text back. Nothing is stored server-side —
 * the response *is* the artifact, and the caller owns it from here.
 *
 * Resolves with `{text, truncated, sourceFilename, sourceType, warnings}`;
 * rejects with an Error carrying a `code` so callers can branch (e.g. keep the
 * file chip on a transient failure, drop it on `unsupported_file_type`).
 */
export async function extractComposeAttachment({ goalId, file, signal }) {
  if (!goalId) throw new Error("extractComposeAttachment: goalId is required");
  if (!file) throw new Error("Attach a document first.");
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw withCode(new Error(EXTRACT_ERROR_COPY.file_too_large), "file_too_large");
  }

  const form = new FormData();
  form.append("file", file);
  form.append("goalId", goalId);

  // `body: undefined` on the second argument is deliberate: it keeps
  // api-client from setting `Content-Type: application/json`, and the FormData
  // rides in via `init` so the browser writes the multipart boundary itself.
  const res = await apiPost("/ai/compose-widget/extract", undefined, {
    body: form,
    signal,
  });

  if (!res.ok) {
    const code = res.error?.code || (res.status === 413 ? "file_too_large" : "extract_failed");
    const message =
      EXTRACT_ERROR_COPY[code] ||
      res.error?.message ||
      `Couldn't read that document (${res.status}).`;
    throw withCode(new Error(message), code);
  }

  const extracted = res.data?.extracted;
  const text = typeof extracted?.text === "string" ? extracted.text : "";
  if (!text.trim()) {
    throw withCode(new Error(EXTRACT_ERROR_COPY.extract_failed), "extract_failed");
  }

  return {
    text,
    truncated: extracted.truncated === true,
    sourceFilename:
      typeof extracted.sourceFilename === "string" ? extracted.sourceFilename : file.name,
    sourceType: typeof extracted.sourceType === "string" ? extracted.sourceType : undefined,
    // Two channels: `warnings` is "check this" (amber), `info` is "here's what
    // I read" (muted). Kept apart so a clean extraction doesn't raise a
    // warning banner — that's how a banner stops meaning anything.
    warnings: toStringList(extracted.warnings),
    info: toStringList(extracted.info),
  };
}

/**
 * Read an SSE response down to its single terminal event.
 *
 * Not a general EventSource replacement — `EventSource` cannot POST, and
 * this stream carries exactly one payload. `progress` events exist only to
 * keep the connection warm and carry nothing worth surfacing, so they are
 * counted and dropped. Resolves with the `result` payload, or with an
 * `__sseError` marker for a failure reported in-band (the status line is
 * long gone by then, so it cannot arrive as an HTTP error).
 */
async function readSseResult(res) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Couldn't build a tracker — the response had no body.");

  const decoder = new TextDecoder();
  let buffer = "";
  let out = null;

  try {
    while (!out) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line. Anything after the last one
      // is a partial frame and stays in the buffer for the next chunk.
      let split;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);

        let event = "message";
        const data = [];
        for (const raw of frame.split("\n")) {
          const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
          if (!line || line.startsWith(":")) continue; // keepalive comment
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trim());
        }
        if (!data.length) continue;

        let payload;
        try {
          payload = JSON.parse(data.join("\n"));
        } catch {
          continue; // a malformed frame is not worth failing the whole run
        }

        if (event === "result") out = payload;
        else if (event === "error") out = { __sseError: true, ...payload };
      }
    }
  } finally {
    // Let the socket go as soon as the answer is in hand, rather than
    // waiting for the server to close it.
    reader.cancel().catch(() => {});
  }

  if (!out) {
    throw new Error("The connection closed before the tracker was ready. Try again.");
  }
  return out;
}

/** Drop an empty/absent attachment entirely rather than sending `{text: ""}`. */
function normalizeAttachment(attachment) {
  const text = typeof attachment?.text === "string" ? attachment.text.trim() : "";
  if (!text) return null;
  return {
    text: text.slice(0, ATTACHMENT_MAX_CHARS),
    ...(attachment.sourceFilename
      ? { sourceFilename: String(attachment.sourceFilename).slice(0, 300) }
      : {}),
    ...(attachment.sourceType ? { sourceType: attachment.sourceType } : {}),
  };
}

function toStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

function withCode(err, code) {
  err.code = code;
  return err;
}
