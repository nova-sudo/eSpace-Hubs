/**
 * Document extraction — the public surface of this folder.
 *
 * The compose-widget flow lets a user attach the planning document they
 * already have (a manager's Word plan, a spreadsheet built in a 1:1)
 * instead of retyping it into a 2,000-character textarea. Everything in
 * this folder exists to turn those bytes into plain text that the LLM
 * prompt can carry — and to do it without handing a hostile file the keys
 * to the API process.
 *
 * Three properties this module guarantees to its callers, in order of how
 * much they cost us to get wrong:
 *
 *   1. Nothing parses in-process. `apps/api` runs as ONE Node process
 *      (see the note in middleware/rate-limit.ts explaining why its
 *      limiter can hold in-memory state) — a decompression bomb or a
 *      pathological PDF that hangs or OOMs the parser takes down every
 *      org, not just the uploader. Every parse happens in a worker thread
 *      with a wall-clock timeout and a heap ceiling; see run-in-worker.ts.
 *   2. Structure survives. A spreadsheet row and a DOCX table row are the
 *      whole point of the feature — "Month 1 | onboarding checklist |
 *      2026-08-31" has to reach the model as one line, not three orphaned
 *      paragraphs. spreadsheet.ts and docx.ts are written around that.
 *   3. Lossiness is never silent. Truncation, skipped sheets, dropped
 *      tables, capped rows — each one pushes a sentence onto `warnings`,
 *      which the UI shows the user. A quiet drop is worse than a loud
 *      failure here, because the user walks away with a tracker that
 *      doesn't match the plan they attached.
 *
 * The endpoint that wraps this is stateless by design: bytes in, text out,
 * nothing written to disk and nothing persisted. `filename` is display
 * metadata only — it is never used to build a path.
 *
 * IMPORTANT for callers: importing this module pulls in run-in-worker.ts and
 * therefore a `new Worker(...)` call, which Turbopack cannot statically
 * analyse — importing it from anywhere reachable by the Next catch-all route
 * breaks the web build. If you only need the constants, the types, or
 * ExtractError, import "./limits.js" instead; it is an import-free leaf. Only
 * the handler that actually parses a file should reach for this module, and it
 * should do so with a dynamic import.
 */

import { detectSource } from "./detect.js";
import { runExtractInWorker } from "./run-in-worker.js";
import {
  ExtractError,
  MAX_EXTRACTED_CHARS,
  MAX_UPLOAD_BYTES,
  type ExtractResult,
} from "./limits.js";

// Re-exported so existing `from "./extract/index.js"` imports keep working.
// New code that doesn't parse should import from "./limits.js" directly.
export {
  ExtractError,
  MAX_UPLOAD_BYTES,
  MAX_EXTRACTED_CHARS,
  EXTRACT_TIMEOUT_MS,
} from "./limits.js";
export type {
  ExtractResult,
  ExtractSourceType,
  ExtractErrorCode,
} from "./limits.js";

/**
 * Turn an uploaded document into prompt-ready plain text.
 *
 * `filename` and `declaredMime` are both client-supplied and both treated
 * as hints: they narrow which parser we reach for, but the magic-byte and
 * archive-structure checks in detect.ts decide whether we parse at all.
 * A .csv that is really a zip, or a .docx carrying vbaProject.bin, is
 * rejected before a parser ever sees it.
 */
export async function extractDocument(
  buffer: Buffer,
  filename: string,
  declaredMime: string,
): Promise<ExtractResult> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ExtractError(
      "unsupported_file_type",
      "That file appears to be empty.",
    );
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new ExtractError(
      "unsupported_file_type",
      `That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
    );
  }

  const detected = detectSource(buffer, filename, declaredMime);
  const parsed = await runExtractInWorker(detected.sourceType, buffer);

  // detect.ts only ever speaks up when something is genuinely off about the
  // file (mislabelled extension, legacy format), so its output is always a
  // warning. The parsers split their own output: counts are info, losses are
  // warnings.
  const warnings = [...detected.warnings, ...parsed.warnings];
  const info = [...parsed.info];
  const normalised = normaliseText(parsed.text);

  if (normalised.length === 0) {
    throw new ExtractError(
      "extract_failed",
      "We couldn't read any text from this document. If it's a scan or a photo of a page, export a text-based version and try again.",
    );
  }

  const { text, truncated } = truncate(normalised);
  if (truncated) {
    warnings.push(
      `The document was longer than we can send to the AI, so only the first ${MAX_EXTRACTED_CHARS.toLocaleString("en-US")} characters were used. Check that nothing important was cut.`,
    );
  }

  return { text, truncated, sourceType: detected.sourceType, warnings, info };
}

/**
 * Collapse the whitespace debris that every extractor produces in its own
 * dialect (pdf.js emits stray \r, mammoth emits runs of blank paragraphs)
 * so the prompt spends its token budget on content. Row and line breaks
 * are load-bearing here, so we never collapse newlines away entirely —
 * only runs of three-or-more down to a paragraph break.
 */
function normaliseText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cut at the cap, but prefer the nearest line break in the last 10% so we
 * don't hand the model half a table row — a truncated row reads as real
 * data, which is exactly the silent-corruption failure this feature can't
 * afford.
 */
function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_CHARS) return { text, truncated: false };
  const hard = text.slice(0, MAX_EXTRACTED_CHARS);
  const lastBreak = hard.lastIndexOf("\n");
  const floor = Math.floor(MAX_EXTRACTED_CHARS * 0.9);
  return {
    text: (lastBreak >= floor ? hard.slice(0, lastBreak) : hard).trimEnd(),
    truncated: true,
  };
}
