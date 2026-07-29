/**
 * Spreadsheet extraction — XLSX via `exceljs`, CSV/TSV via a parser in
 * this file.
 *
 * Two decisions worth stating up front:
 *
 * 1. `exceljs`, never `xlsx`/SheetJS (finding C3). The web app already
 *    depends on `xlsx@0.18.5`, and reaching for the same package here
 *    would look like reuse. It isn't: that line carries an unpatched
 *    prototype-pollution bug and a ReDoS, and SheetJS publishes its fixed
 *    releases to its own CDN rather than to npm — so `xlsx@latest` still
 *    resolves to the vulnerable line. A bad parse in a browser tab is the
 *    user's own tab; a bad parse here is the shared API process. `xlsx`
 *    must never be imported under apps/api.
 *
 * 2. Rows are the payload. The whole reason someone attaches a plan
 *    spreadsheet is that "Month 1 | onboarding checklist | 2026-08-31"
 *    belongs together — a bag of loose cell values is not a lossy version
 *    of that, it's a useless one. Both paths below emit one line per row
 *    with cells pipe-joined, and both report how much they read so a
 *    truncated sheet is visible rather than assumed complete.
 *
 * Dates get formatted here rather than left to `cell.text`, which renders
 * them in the server's locale ("Mon Aug 31 2026 03:00:00 GMT+0300"). Due
 * dates are the point of these documents; they go out as ISO.
 */

import ExcelJS from "exceljs";

/** Guards against a workbook that is technically valid but absurd. */
const MAX_SHEETS = 20;
const MAX_ROWS_PER_SHEET = 2_000;
const MAX_COLUMNS = 64;
const MAX_CELL_CHARS = 500;
/** CSV has no sheets, so it gets a single, larger row budget. */
const MAX_CSV_ROWS = 5_000;

const DELIMITERS = [",", "\t", ";", "|"] as const;
const DELIMITER_NAMES: Record<string, string> = {
  ",": "comma-separated",
  "\t": "tab-separated",
  ";": "semicolon-separated",
  "|": "pipe-separated",
};

/**
 * Join one row for the model, collapsing RUNS of empty cells.
 *
 * Real exports are full of padding. The growth-goals sheet this was built
 * against pads every row out to 13 columns, so a single checkpoint reached the
 * model as its text followed by eleven empty separators before the due date —
 * tokens spent on nothing, and the row's actual shape buried in the noise.
 *
 * A run collapses to ONE empty cell rather than disappearing. Dropping gaps
 * outright would turn a row like "Jan, 100, <blank>, 300" into "Jan | 100 |
 * 300" and silently re-attribute that 300 to the wrong column; keeping a single
 * marker says "there was a gap here" without the padding.
 */
function joinRow(cells: string[]): string {
  const out: string[] = [];
  let inBlankRun = false;
  for (const cell of cells) {
    if (cell === "") {
      if (!inBlankRun) out.push("");
      inBlankRun = true;
      continue;
    }
    inBlankRun = false;
    out.push(cell);
  }
  // Trailing blanks are formatting, never data.
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join(" | ");
}

export async function extractWorkbook(
  buffer: Buffer,
): Promise<{ text: string; warnings: string[]; info: string[] }> {
  const workbook = new ExcelJS.Workbook();
  // exceljs' own index.d.ts declares a local `interface Buffer extends
  // ArrayBuffer`, which a real Node Buffer does not structurally satisfy.
  // Runtime is perfectly happy with the Buffer; the cast bridges a bad
  // ambient declaration and nothing more.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const warnings: string[] = [];
  const info: string[] = [];
  const blocks: string[] = [];
  let sheetsRead = 0;
  let rowsRead = 0;
  let emptySheets = 0;

  const sheets = workbook.worksheets ?? [];
  const considered = sheets.slice(0, MAX_SHEETS);
  if (sheets.length > considered.length) {
    warnings.push(
      `This workbook has ${sheets.length} sheets; only the first ${considered.length} were read.`,
    );
  }

  for (const sheet of considered) {
    const lines: string[] = [];
    let rowsInSheet = 0;
    let truncatedRows = false;
    let truncatedColumns = false;

    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rowsInSheet >= MAX_ROWS_PER_SHEET) {
        truncatedRows = true;
        return;
      }
      const width = Math.min(row.cellCount, MAX_COLUMNS);
      if (row.cellCount > MAX_COLUMNS) truncatedColumns = true;

      const cells: string[] = [];
      for (let column = 1; column <= width; column += 1) {
        cells.push(cellToText(row.getCell(column).value));
      }
      if (cells.every((c) => c === "")) return;

      lines.push(joinRow(cells));
      rowsInSheet += 1;
    });

    if (lines.length === 0) {
      emptySheets += 1;
      continue;
    }

    sheetsRead += 1;
    rowsRead += rowsInSheet;
    blocks.push(`Sheet: ${sheet.name}\n${lines.join("\n")}`);

    if (truncatedRows) {
      warnings.push(
        `Sheet "${sheet.name}" was longer than ${MAX_ROWS_PER_SHEET.toLocaleString("en-US")} rows; the rest was skipped.`,
      );
    }
    if (truncatedColumns) {
      warnings.push(
        `Sheet "${sheet.name}" has more than ${MAX_COLUMNS} columns; only the first ${MAX_COLUMNS} were read.`,
      );
    }
  }

  info.unshift(
    `Read ${sheetsRead} sheet${sheetsRead === 1 ? "" : "s"} and ${rowsRead} row${rowsRead === 1 ? "" : "s"}.`,
  );
  if (emptySheets > 0) {
    warnings.push(
      `Skipped ${emptySheets} empty sheet${emptySheets === 1 ? "" : "s"}.`,
    );
  }

  return { text: blocks.join("\n\n"), warnings, info };
}

/**
 * CSV/TSV. Hand-rolled rather than routed through exceljs' CSV reader,
 * for three reasons: it needs a stream rather than a buffer, it coerces
 * cell values on the way in (so "2026-08-31" stops being the string the
 * document actually said), and it is weaker on quoting than the ~40 lines
 * below. This is a plain character scanner — no regex over user input, so
 * there is no backtracking behaviour to reason about.
 */
export function extractDelimitedText(buffer: Buffer): {
  text: string;
  warnings: string[];
  info: string[];
} {
  const raw = buffer
    .toString("utf8")
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n");

  const delimiter = sniffDelimiter(raw);
  const { rows, truncated } = parseDelimited(raw, delimiter, MAX_CSV_ROWS);

  const lines = rows
    .map((row) => joinRow([...row]))
    .filter((line) => line.trim().length > 0);

  const warnings: string[] = [];
  const info = [
    `Read ${lines.length} row${lines.length === 1 ? "" : "s"} (${DELIMITER_NAMES[delimiter] ?? "delimited"}).`,
  ];
  if (truncated) {
    warnings.push(
      `The file had more than ${MAX_CSV_ROWS.toLocaleString("en-US")} rows; the rest was skipped.`,
    );
  }

  return { text: lines.join("\n"), warnings, info };
}

/**
 * Try each candidate delimiter over the head of the file and keep the one
 * that produces the most columns consistently. Counting raw characters
 * would be fooled by prose containing commas; actually parsing 20 rows
 * and looking at the shape is barely more work and is right more often.
 */
function sniffDelimiter(text: string): string {
  const head = text.slice(0, 64 * 1024);
  let best = DELIMITERS[0] as string;
  let bestScore = 0;

  for (const candidate of DELIMITERS) {
    const { rows } = parseDelimited(head, candidate, 20);
    const populated = rows.filter((row) => row.length > 1);
    if (populated.length === 0) continue;
    // Modal column count — a real delimiter yields the same width on most
    // rows; a coincidental one yields noise.
    const counts = new Map<number, number>();
    for (const row of populated) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
    let modeWidth = 0;
    let modeRows = 0;
    for (const [width, seen] of counts) {
      if (seen > modeRows || (seen === modeRows && width > modeWidth)) {
        modeWidth = width;
        modeRows = seen;
      }
    }
    const score = modeRows * modeWidth;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function parseDelimited(
  text: string,
  delimiter: string,
  maxRows: number,
): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let at = 0;

  while (at < text.length) {
    const char = text[at] as string;

    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') {
          field += '"';
          at += 2;
          continue;
        }
        quoted = false;
        at += 1;
        continue;
      }
      field += char;
      at += 1;
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
      at += 1;
      continue;
    }
    if (char === delimiter) {
      row.push(field.trim());
      field = "";
      at += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
      at += 1;
      if (rows.length >= maxRows) return { rows, truncated: at < text.length };
      continue;
    }

    field += char;
    at += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return { rows, truncated: false };
}

/**
 * exceljs cell values are a tagged union in all but name: primitives,
 * Dates, rich-text runs, formula results, hyperlinks and error markers.
 * Everything collapses to the string a human would have seen in the cell.
 */
function cellToText(value: unknown): string {
  const text = renderCellValue(value);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_CELL_CHARS ? `${flat.slice(0, MAX_CELL_CHARS)}…` : flat;
}

function renderCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(renderCellValue).join(" ");

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.richText)) {
      return record.richText
        .map((run) => (run && typeof run === "object" ? String((run as { text?: unknown }).text ?? "") : ""))
        .join("");
    }
    // A formula cell: prefer the cached result — that's what the document
    // shows. Fall back to the formula so an uncalculated sheet isn't blank.
    if ("formula" in record || "sharedFormula" in record) {
      const result = renderCellValue(record.result);
      if (result) return result;
      const formula = record.formula ?? record.sharedFormula;
      return typeof formula === "string" ? `=${formula}` : "";
    }
    // Hyperlink cells carry the display text alongside the target.
    if ("text" in record) return renderCellValue(record.text);
    // Error cells (#REF!, #DIV/0!) read as noise; leave them blank.
    if ("error" in record) return "";
  }

  return "";
}

/**
 * Plain ISO date for a midnight value, ISO minutes when there is a real
 * time component. Excel stores both as the same serial number, so this is
 * the only signal available for telling a due date from a timestamp.
 */
function formatDate(value: Date): string {
  const iso = value.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
}
