/**
 * Extraction limits, types, and the error class — deliberately a LEAF module
 * with zero imports.
 *
 * Why this is split out of index.ts rather than living beside extractDocument:
 * `apps/web` re-exports this API's Express app through a Next catch-all route
 * (apps/web/src/pages/api/v1/[...path].ts → apps/api/dist/serverless.js), so
 * anything transitively reachable from the router lands in Turbopack's module
 * graph. index.ts reaches run-in-worker.ts, which calls `new Worker(entry)`
 * with a runtime-computed path; Turbopack treats a non-static Worker argument
 * as a context module and tries to parse every file in the resolved directory,
 * which breaks the web build outright (it choked on Dockerfile and
 * tsconfig.tsbuildinfo).
 *
 * So: the route layer and the compose path — which only ever need the numbers
 * and the error type — import from HERE, and the worker machinery is pulled in
 * lazily, inside the one handler that actually parses a file. Keep this file
 * import-free; adding an import to it re-opens the bundling problem it exists
 * to close.
 */

export type ExtractSourceType = "pdf" | "docx" | "xlsx" | "xls" | "csv";

export interface ExtractResult {
  /** Extracted plain text, already normalised and truncated to the cap. */
  text: string;
  /** True when the source exceeded MAX_EXTRACTED_CHARS and was cut. */
  truncated: boolean;
  sourceType: ExtractSourceType;
  /**
   * Things the user should CHECK — truncation, a dropped table, a skipped
   * sheet. Rendered in the UI's amber warning banner, so this list must stay
   * genuinely exceptional: see `info` for the neutral "here's what I read"
   * counts. Every entry here costs a little of the user's trust in the banner.
   */
  warnings: string[];
  /**
   * Neutral telemetry about what was read ("Read 6 rows", "Found 2 tables").
   * Shown as plain muted text, never as a warning. Split from `warnings`
   * because an amber banner that fires on every successful extraction trains
   * users to ignore the one that matters.
   */
  info: string[];
}

/**
 * 10 MB. Comfortably covers the documents this feature was built for (a
 * two-page Word plan, a six-row spreadsheet) while keeping the amount of
 * attacker-controlled input the parsers ever see small. Multer enforces
 * this at the HTTP layer before a byte reaches us; we re-check anyway,
 * because "some other caller" is always eventually true.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * 20,000 characters. This is a *cost* bound, not a parsing bound — the
 * extracted text is spliced into an LLM prompt that is billed per token.
 * It is deliberately enforced here, server-side, and not trusted from the
 * client: the compose route re-validates the same cap on the way in.
 */
export const MAX_EXTRACTED_CHARS = 20_000;

/**
 * 15 seconds of wall clock. Long enough for a big-but-legitimate PDF on a
 * cold worker, short enough that a hang is a 504 rather than a hostage
 * situation. Enforced by killing the worker, not by asking it to stop.
 */
export const EXTRACT_TIMEOUT_MS = 15_000;

export type ExtractErrorCode =
  | "unsupported_file_type"
  | "extract_failed"
  | "extract_timeout";

/**
 * The only error type that escapes this module. Its `message` is written
 * to be shown to a human — the raw parser exception never is (per the rule
 * stated in middleware/error-handler.ts). The route layer maps the code to
 * a status: unsupported_file_type → 400, extract_failed → 422,
 * extract_timeout → 504.
 *
 * The message is deliberately specific per failure ("re-save this .xlsm as
 * .xlsx" reads very differently from "unsupported type"), so callers should
 * surface `message` rather than substituting their own copy for the code.
 */
export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  /**
   * Short, redacted parser detail for the server log only. Never put this
   * in a response body, and never let document *content* into it — the
   * worker truncates it hard before it crosses the thread boundary (W9).
   */
  readonly detail: string | undefined;

  constructor(code: ExtractErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
    this.detail = detail;
  }
}
