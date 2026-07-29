/**
 * DOCX text extraction — table-preserving, on purpose.
 *
 * The obvious call here is `mammoth.extractRawText`, and it is the wrong
 * one. It emits every table cell as its own paragraph, so a three-column
 * row comes out as:
 *
 *   Month 1
 *   Onboarding checklist
 *   2026-08-31
 *
 * …with nothing saying those three belong together. The documents this
 * feature exists for are almost entirely tables — a 13-row weekly plan, a
 * 6-row monthly checkpoint grid — so that flattening doesn't lose a
 * detail, it loses the plan. Worse, it loses it silently: the text looks
 * fine, and the tracker that comes out the other end is subtly wrong.
 * The spec calls this out as a real risk; this file is the answer to it.
 *
 * So we convert to HTML instead and linearise it ourselves, emitting each
 * table row as one pipe-joined line. Parsing HTML with a hand-rolled
 * tokeniser is normally a bad idea — it is safe *here*, and only here,
 * because the input is not arbitrary markup: it is mammoth's own writer
 * output, which escapes `<` and `>` in both text and attribute values
 * (see writers/html-writer.js). There is therefore no `<` or `>` inside a
 * tag or a text node that isn't a real delimiter. We never render this
 * HTML, so no sanitiser is in play (advisory A7).
 *
 * Two more things this file is careful about:
 *   - `externalFileAccess` stays false (W4 / CVE-2025-11849): a crafted
 *     DOCX can reference images by external `r:link`, and mammoth ≥1.11
 *     refuses to follow them. We set it explicitly rather than trusting
 *     the default to stay put across upgrades.
 *   - Images are converted to an empty `<img>` without ever calling
 *     `read()`. Mammoth's default embeds every image as a base64 data
 *     URI, which would inflate the intermediate HTML by megabytes for
 *     text we then throw away.
 */

import mammoth from "mammoth";

/** Emits an <img> shell without reading a single byte of image data. */
const DROP_IMAGES = mammoth.images.imgElement(async () => ({ src: "" }));

export async function extractDocx(
  buffer: Buffer,
): Promise<{ text: string; warnings: string[]; info: string[] }> {
  const warnings: string[] = [];
  const info: string[] = [];

  let html: string;
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: DROP_IMAGES,
        externalFileAccess: false,
        ignoreEmptyParagraphs: true,
      },
    );
    html = result.value ?? "";
    // Mammoth's messages name unmapped Word styles. We report the count
    // rather than the list: the count is what tells a user "something in
    // here didn't map", and the list is document metadata we'd rather not
    // ship to the browser or the log.
    if (result.messages.length > 0) {
      warnings.push(
        `${result.messages.length} formatting element${result.messages.length === 1 ? "" : "s"} in the document couldn't be mapped; the text was still read.`,
      );
    }
  } catch {
    // Layout conversion failed but the raw text path may still work. Take
    // it — and say plainly that tables are probably gone, because that is
    // exactly the silent loss this file exists to prevent.
    const raw = await mammoth.extractRawText({ buffer });
    warnings.push(
      "We could only read this document as plain text, so any table layout was lost. Check the extracted text before continuing.",
    );
    return { text: raw.value ?? "", warnings, info };
  }

  const { text, tables, rows } = linearise(html);

  info.push(
    tables > 0
      ? `Found ${tables} table${tables === 1 ? "" : "s"} — ${rows} row${rows === 1 ? "" : "s"} kept, one line per row.`
      : "No tables were found in this document.",
  );

  return { text, warnings, info };
}

/**
 * Block-level tags whose close is a line break in the output. Anything not
 * listed (strong, em, a, span, sup…) is inline and contributes only its
 * text, which is what we want — the model reads content, not styling.
 */
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
]);

interface Linearised {
  text: string;
  tables: number;
  rows: number;
}

function linearise(html: string): Linearised {
  const out: string[] = [];
  let line: string[] = [];
  let cell: string[] | null = null;
  let row: string[] | null = null;
  let tableDepth = 0;
  let tables = 0;
  let rows = 0;

  const flushLine = (): void => {
    const text = squash(line.join(""));
    if (text) out.push(text);
    line = [];
  };
  const flushRow = (): void => {
    if (!row) return;
    if (row.some((value) => value.length > 0)) {
      out.push(row.join(" | "));
      rows += 1;
    }
    row = null;
  };

  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open === -1) {
      appendText(cell ?? line, html.slice(at));
      break;
    }
    if (open > at) appendText(cell ?? line, html.slice(at, open));

    const close = html.indexOf(">", open);
    if (close === -1) {
      // Unterminated tag: treat the remainder as text rather than dropping
      // it. Mammoth never emits this, but a truncated buffer could.
      appendText(cell ?? line, html.slice(open));
      break;
    }

    const raw = html.slice(open + 1, close);
    at = close + 1;

    const closing = raw.startsWith("/");
    const name = (closing ? raw.slice(1) : raw)
      .split(/[\s/]/, 1)[0]
      ?.toLowerCase();
    if (!name) continue;

    switch (name) {
      case "table":
        if (closing) {
          flushRow();
          tableDepth = Math.max(0, tableDepth - 1);
          if (tableDepth === 0) out.push("");
        } else {
          flushLine();
          if (tableDepth === 0) out.push("");
          tableDepth += 1;
          tables += 1;
        }
        break;
      case "tr":
        if (closing) flushRow();
        else row = [];
        break;
      case "td":
      case "th":
        if (closing) {
          if (cell) {
            row = row ?? [];
            row.push(squash(cell.join("")));
            cell = null;
          }
        } else {
          cell = [];
        }
        break;
      case "br":
        if (cell) cell.push(" ");
        else flushLine();
        break;
      case "li":
        if (closing) {
          if (cell) cell.push(" ");
          else flushLine();
        } else if (!cell) {
          flushLine();
          line.push("- ");
        }
        break;
      default:
        if (BLOCK_TAGS.has(name)) {
          if (cell) cell.push(" ");
          else if (closing) flushLine();
        }
        break;
    }
  }

  flushRow();
  flushLine();

  return { text: out.join("\n"), tables, rows };
}

function appendText(sink: string[], chunk: string): void {
  if (chunk) sink.push(decodeEntities(chunk));
}

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Mammoth escapes exactly `&`, `<`, `>` and `"`, and Word content arrives
 * carrying whatever numeric entities the original XML used — so this
 * covers the whole surface without pulling in an entity table.
 */
function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g,
    (match, dec: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (dec) return safeCodePoint(Number.parseInt(dec, 10)) ?? match;
      if (hex) return safeCodePoint(Number.parseInt(hex, 16)) ?? match;
      switch (named) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        case "apos":
          return "'";
        case "nbsp":
          return " ";
        default:
          return match;
      }
    },
  );
}

function safeCodePoint(code: number): string | null {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
  try {
    return String.fromCodePoint(code);
  } catch {
    return null;
  }
}
