/**
 * Worker-thread isolation for document parsing (security finding C1).
 *
 * `apps/api` is a single Node process serving every org. `pdf-parse`,
 * `mammoth` and `exceljs` are all synchronous-ish, CPU-bound parsers over
 * fully attacker-controlled input; a decompression bomb, a pathological
 * XRef table or a crafted shared-strings table that pins the CPU or eats
 * the heap doesn't degrade one request, it takes the API down for
 * everyone. So no parse ever runs on the main thread. Each one gets:
 *
 *   - a fresh worker, torn down after a single document;
 *   - `resourceLimits`, so V8 kills the thread instead of the process when
 *     the heap runs away;
 *   - a wall-clock timer we own, because a spin loop never yields and no
 *     amount of cooperative checking inside the parser would catch it. On
 *     expiry we `terminate()` — we don't ask, we kill.
 *
 * ── The worker-path problem, and how it's solved ──────────────────────
 * `new Worker(path)` needs a path that exists in whichever mode the server
 * happens to be running. This repo has two:
 *
 *   dev:   tsx src/server.ts   → this module is `.../extract/run-in-worker.ts`
 *   prod:  node dist/server.js → this module is `.../extract/run-in-worker.js`
 *
 * Hardcoding either one works in exactly one of them, which is the classic
 * way this breaks — in production, months later. Instead we derive the
 * worker path from *our own* `import.meta.url`: same directory, same
 * extension. Under tsx we spawn `worker.ts`; compiled we spawn `worker.js`.
 * A fallback tries the other extension so a mixed layout still resolves
 * rather than failing cryptically.
 *
 * Spawning a `.ts` entry only works because tsx installs its loader via
 * `process.execArgv` (`--import .../tsx/dist/loader.mjs`), and worker
 * threads inherit `execArgv` from the parent by default. That inheritance
 * is load-bearing: we deliberately do NOT pass an `execArgv` option here,
 * because doing so would replace the inherited list and the TypeScript
 * worker would fail to load in dev. The `env` allow-list below is
 * likewise built to preserve `NODE_OPTIONS` for the same reason.
 *
 * Only tsx's *transform* hook survives the thread boundary, though — its
 * `.js`→`.ts` *resolve* hook does not, which is why worker.ts loads its
 * own siblings by absolute URL rather than by relative specifier. That
 * half of the problem is documented there.
 */

import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExtractError, EXTRACT_TIMEOUT_MS, type ExtractSourceType } from "./index.js";

/** What the parent hands the worker, as `workerData`. */
export interface ExtractWorkerInput {
  sourceType: ExtractSourceType;
  bytes: Uint8Array;
}

/**
 * What the worker posts back. Failure carries a short, redacted `detail`
 * for the server log only — never a response body, and never document
 * text (W9).
 */
export type ExtractWorkerOutput =
  | { ok: true; text: string; warnings: string[]; info: string[] }
  | { ok: false; detail: string };

/**
 * Heap ceiling for a parse. Generous enough that a real 10 MB workbook
 * expanding into an object model still finishes, small enough that a bomb
 * hits V8's limit long before it hits the container's. Exported so the
 * numbers are reviewable in one place rather than buried in a call.
 */
export const EXTRACT_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 512,
  maxYoungGenerationSizeMb: 32,
  codeRangeSizeMb: 32,
  stackSizeMb: 4,
};

/**
 * The worker parses documents; it has no business reading MongoDB URIs or
 * provider API keys, so it doesn't get them. Only the variables that
 * affect *how Node itself starts* are forwarded — `NODE_OPTIONS` because a
 * loader may be registered through it, `TZ` because date cells in a
 * spreadsheet are rendered relative to it, `NODE_ENV` because library
 * warning behaviour keys off it.
 */
const WORKER_ENV_ALLOWLIST = ["NODE_OPTIONS", "NODE_ENV", "TZ"] as const;

let cachedWorkerEntry: string | null = null;

export async function runExtractInWorker(
  sourceType: ExtractSourceType,
  buffer: Buffer,
): Promise<{ text: string; warnings: string[]; info: string[] }> {
  const entry = resolveWorkerEntry();

  // Passed by structured clone, not transferred. Multer's memoryStorage
  // buffer can be a view onto a pooled ArrayBuffer, so transferring it
  // would detach memory that isn't exclusively ours; a copy of at most
  // 10 MB is a cheap price for not having to reason about that.
  const input: ExtractWorkerInput = { sourceType, bytes: buffer };

  const worker = new Worker(entry, {
    workerData: input,
    resourceLimits: EXTRACT_RESOURCE_LIMITS,
    env: workerEnv(),
    // No `execArgv` here on purpose — see the header comment. Inheriting
    // the parent's is what makes the dev (tsx) path work.
  });

  try {
    return await new Promise<{ text: string; warnings: string[]; info: string[] }>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new ExtractError(
              "extract_timeout",
              "Reading that document took too long. Try a smaller or simpler file.",
              `timeout after ${EXTRACT_TIMEOUT_MS}ms`,
            ),
          ),
        );
      }, EXTRACT_TIMEOUT_MS);
      // Don't let the timer alone hold the process open during shutdown.
      timer.unref?.();

      worker.on("message", (message: ExtractWorkerOutput) => {
        finish(() => {
          if (message && message.ok) {
            resolve({ text: message.text, warnings: message.warnings, info: message.info ?? [] });
          } else {
            reject(parseFailure(message?.detail));
          }
        });
      });

      // A `resourceLimits` breach surfaces here (ERR_WORKER_OUT_OF_MEMORY,
      // or an allocation failure for off-heap buffers) — the thread is
      // already dead by the time we see it, which is the whole point.
      worker.on("error", (err: Error) => {
        finish(() => reject(parseFailure(redact(err))));
      });

      worker.on("exit", (code) => {
        finish(() => reject(parseFailure(`worker exited with code ${code}`)));
      });
    });
  } finally {
    // Unconditional: on the happy path this reaps a thread that has
    // already finished, on the timeout path it is the kill.
    await worker.terminate().catch(() => undefined);
  }
}

/**
 * One generic message for every parser failure. Encrypted PDFs, corrupt
 * archives and library assertions all look the same to the user by design
 * — error-handler.ts's rule is that nothing we didn't author reaches the
 * client, and a parser exception is the definition of that.
 */
function parseFailure(detail: string | undefined): ExtractError {
  return new ExtractError(
    "extract_failed",
    "We couldn't read this document. It may be password-protected, corrupted, or saved in a format we can't open.",
    detail,
  );
}

/**
 * Parser exceptions occasionally quote the input they choked on. Keep the
 * error name and a short prefix for debugging; drop the rest, because it
 * would otherwise be document content in a persistent log (W9).
 */
function redact(err: Error): string {
  const name = err?.name || "Error";
  const message = String(err?.message ?? "").slice(0, 200);
  return `${name}: ${message}`;
}

function workerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of WORKER_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function resolveWorkerEntry(): string {
  if (cachedWorkerEntry) return cachedWorkerEntry;

  const self = fileURLToPath(import.meta.url);
  const dir = path.dirname(self);
  const ext = path.extname(self); // ".ts" under tsx, ".js" once compiled
  const candidates = [
    path.join(dir, `worker${ext}`),
    path.join(dir, "worker.js"),
    path.join(dir, "worker.ts"),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    // Not an ExtractError: this is a deployment fault, not a bad upload,
    // and should surface as a 500 with a real stack in the logs.
    throw new Error(
      `document extraction worker not found next to ${self} (looked for worker${ext})`,
    );
  }

  cachedWorkerEntry = found;
  return found;
}
