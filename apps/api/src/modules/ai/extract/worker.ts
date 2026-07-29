/**
 * The worker-thread entry point. This is the only file in the repo where
 * `pdf-parse`, `mammoth` and `exceljs` actually execute — everything they
 * touch is attacker-controlled, so it all happens over here behind the
 * heap ceiling and kill switch set up in run-in-worker.ts.
 *
 * ── Why the sibling modules are loaded by absolute URL ────────────────
 * Everywhere else in `apps/api` a relative import is written `"./x.js"`
 * and tsx rewrites it to `./x.ts` in dev. That rewrite does **not** happen
 * inside a worker thread: tsx's *transform* hook is inherited (this file
 * is TypeScript and it runs), but its *resolve* hook is not, so a plain
 * `import "./pdf.js"` in here fails with "Cannot find module …/pdf.js" in
 * dev while working perfectly once compiled. That asymmetry is the exact
 * shape of bug that only ever shows up in one of the two environments.
 *
 * So the sibling parsers are loaded through a `file://` URL built from
 * *this file's own* extension: `.ts` when tsx is running us, `.js` when
 * we're running out of `dist/`. An absolute URL skips extension
 * resolution entirely, so both modes take the same code path. The static
 * `import type` lines still give us full type-checking — they erase, and
 * TypeScript resolves them normally at compile time.
 *
 * Loading lazily also means a CSV upload never pays to initialise pdf.js
 * and a PDF upload never loads exceljs; startup is charged per request
 * here, and these libraries are not small.
 *
 * The other deliberate constraint: nothing from `index.ts` is imported at
 * runtime (types only). The contract lives there, but importing it would
 * drag `run-in-worker.ts` — and the Worker machinery — into every spawned
 * thread for no reason.
 *
 * Nothing throws out of this file. A parse failure is posted back as a
 * structured `{ok:false, detail}` and the parent turns it into the single
 * generic user-facing message; letting a library exception escape would
 * put a raw parser string on the 'error' event, and eventually in a log,
 * with whatever fragment of the document it decided to quote.
 */

import { parentPort, workerData } from "node:worker_threads";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as PdfModule from "./pdf.js";
import type * as DocxModule from "./docx.js";
import type * as SpreadsheetModule from "./spreadsheet.js";
import type { ExtractWorkerInput, ExtractWorkerOutput } from "./run-in-worker.js";

const SELF = fileURLToPath(import.meta.url);
const DIR = path.dirname(SELF);
const EXT = path.extname(SELF);

/**
 * Resolve a sibling module to an absolute `file://` URL, preferring our
 * own extension and falling back to the other so a mixed layout still
 * loads instead of failing cryptically at request time.
 */
function siblingUrl(name: string): string {
  const candidates = [
    path.join(DIR, `${name}${EXT}`),
    path.join(DIR, `${name}.js`),
    path.join(DIR, `${name}.ts`),
  ];
  const found = candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
  return pathToFileURL(found).href;
}

async function main(): Promise<ExtractWorkerOutput> {
  const input = workerData as ExtractWorkerInput | undefined;
  if (!input || !input.bytes) {
    return { ok: false, detail: "worker started without input" };
  }

  // The structured clone hands us a Uint8Array; re-view it as a Buffer
  // without copying, since every parser below wants one.
  const bytes = input.bytes;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  switch (input.sourceType) {
    case "pdf": {
      const { extractPdf } = (await import(siblingUrl("pdf"))) as typeof PdfModule;
      return { ok: true, ...(await extractPdf(buffer)) };
    }
    case "docx": {
      const { extractDocx } = (await import(siblingUrl("docx"))) as typeof DocxModule;
      return { ok: true, ...(await extractDocx(buffer)) };
    }
    case "xlsx":
    case "xls": {
      const { extractWorkbook } = (await import(
        siblingUrl("spreadsheet")
      )) as typeof SpreadsheetModule;
      return { ok: true, ...(await extractWorkbook(buffer)) };
    }
    case "csv": {
      const { extractDelimitedText } = (await import(
        siblingUrl("spreadsheet")
      )) as typeof SpreadsheetModule;
      return { ok: true, ...extractDelimitedText(buffer) };
    }
    default:
      return { ok: false, detail: "unhandled source type" };
  }
}

main()
  .then((result) => parentPort?.postMessage(result))
  .catch((err: unknown) => {
    const name = err instanceof Error ? err.name : "Error";
    const message = err instanceof Error ? String(err.message).slice(0, 200) : "";
    const failure: ExtractWorkerOutput = { ok: false, detail: `${name}: ${message}` };
    parentPort?.postMessage(failure);
  });
