/**
 * PDF text extraction, via `pdf-parse` v2 (which wraps `pdfjs-dist`).
 *
 * ── The load options are load-bearing, not stylistic ──────────────────
 * `isEvalSupported` defaults to **true** in pdf.js, which means a PDF's
 * PostScript calculator functions get compiled and run — CVE-2024-4367,
 * and RCE-adjacent when the file arrived over HTTP and you're executing
 * it inside your API. We pass `false` explicitly and unconditionally, not
 * because the pinned version is vulnerable but because the pin is not the
 * thing keeping us safe (finding C2). Everything else switched off below
 * follows the same rule: text extraction needs no rendering engine, no
 * font loader and no network, so none of them are enabled.
 *
 * ── Why the native canvas addon is stubbed out ────────────────────────
 * `pdfjs-dist`'s legacy build — the one `pdf-parse` imports — does an
 * eager `require("@napi-rs/canvas")` at module scope purely to borrow
 * `DOMMatrix`/`ImageData`/`Path2D`, then builds a `new DOMMatrix()` at
 * module scope too. That drags a native rendering addon into every
 * extraction worker, and empirically (Node 22, Windows, ~15% of runs)
 * that addon segfaults the *process* when the worker thread tears down.
 * A native crash is the one failure the worker isolation in
 * run-in-worker.ts cannot contain: it takes the API down for every org,
 * which is precisely the outcome finding C1 exists to prevent.
 *
 * So before `pdf-parse` is imported we intercept the CJS loader and hand
 * pdf.js three tiny pure-JS classes instead of the addon. They satisfy
 * the module-scope construction; `createCanvas` throws, because reaching
 * it would mean something tried to *render*, which this code path never
 * does. The interception is installed lazily, from inside `extractPdf`,
 * so it is scoped to the short-lived extraction worker and never alters
 * module resolution in the API process itself.
 *
 * If a future pdf.js genuinely needs a real canvas here, the fix is not
 * to re-enable the addon in-thread — it's to move PDF parsing to a child
 * *process*, where a native crash is survivable.
 *
 * pdf.js has no OCR. A scanned page yields an empty string, which the
 * caller turns into an explicit "this looks like a scan" error rather
 * than a tracker built from nothing.
 */

import { Module } from "node:module";
import type { PDFParse as PDFParseClass } from "pdf-parse";

/**
 * Page ceiling. The 20,000-character cap upstream means a long document
 * gets truncated anyway; stopping early keeps a 600-page report from
 * spending the whole 15-second budget producing text we'd discard.
 */
const MAX_PAGES = 120;

/** Enough of a DOMMatrix for pdf.js' module-scope `new DOMMatrix()`. */
class MinimalDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: unknown) {
    if (Array.isArray(init) && init.length === 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init as number[];
    }
  }
}

class MinimalImageData {
  readonly width: number;
  readonly height: number;
  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
  }
}

class MinimalPath2D {}

const CANVAS_STUB = {
  DOMMatrix: MinimalDOMMatrix,
  ImageData: MinimalImageData,
  Path2D: MinimalPath2D,
  createCanvas(): never {
    throw new Error("canvas rendering is disabled during text extraction");
  },
};

type CjsLoader = {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
};

let pdfParseModule: Promise<{ PDFParse: typeof PDFParseClass }> | null = null;

/**
 * Install the canvas stub, then import `pdf-parse`. Memoised because the
 * interception must happen exactly once and strictly before pdf.js is
 * evaluated — a static `import` at the top of this file would be hoisted
 * above the patch and defeat it.
 */
function loadPdfParse(): Promise<{ PDFParse: typeof PDFParseClass }> {
  if (pdfParseModule) return pdfParseModule;

  const loader = Module as unknown as CjsLoader;
  const original = loader._load;
  loader._load = function intercepted(
    this: unknown,
    request: string,
    parent: unknown,
    isMain: boolean,
  ): unknown {
    if (request === "@napi-rs/canvas") return CANVAS_STUB;
    return original.call(this, request, parent, isMain);
  };

  pdfParseModule = import("pdf-parse");
  return pdfParseModule;
}

export async function extractPdf(
  buffer: Buffer,
): Promise<{ text: string; warnings: string[]; info: string[] }> {
  const { PDFParse } = await loadPdfParse();
  const warnings: string[] = [];
  const info: string[] = [];

  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    // C2 — never compile or evaluate content-supplied expressions.
    isEvalSupported: false,
    // No canvas, no font loading, no system font enumeration: all of it
    // is rendering surface we don't use and don't want reachable.
    isOffscreenCanvasSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    // `data` is already in memory, so there is nothing to range-request.
    // Leaving cMapUrl/standardFontDataUrl unset keeps pdf.js from
    // fetching either — extraction makes zero outbound calls (W4).
    disableAutoFetch: true,
    disableStream: true,
    // ERRORS only. pdf.js is chatty about malformed files, and those
    // warnings can quote document internals (W9).
    verbosity: 0,
  });

  try {
    const result = await parser.getText({
      first: MAX_PAGES,
      // A wide horizontal gap becomes a tab rather than a space, which is
      // what keeps a table in a PDF reading as columns instead of a
      // run-on sentence.
      cellSeparator: "\t",
      lineEnforce: true,
      pageJoiner: "",
    });

    const readPages = result.pages.length;
    const totalPages = result.total || readPages;
    info.push(`Read ${readPages} page${readPages === 1 ? "" : "s"} from the PDF.`);
    if (totalPages > readPages) {
      warnings.push(
        `Only the first ${readPages} of ${totalPages} pages were read — the rest were skipped.`,
      );
    }

    return { text: result.text ?? "", warnings, info };
  } finally {
    // pdf.js holds a document worker plus a typed-array cache; skipping
    // this leaks both for the lifetime of the thread.
    await parser.destroy().catch(() => undefined);
  }
}
