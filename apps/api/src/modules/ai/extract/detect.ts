/**
 * File-type detection — the gate that decides whether a parser runs at all.
 *
 * The filename and the multipart Content-Type are both written by the
 * client, so neither is evidence of anything. This module treats them as a
 * *request* ("please parse me as a .docx") and then checks the bytes to
 * decide whether that request is honest. A .csv that is really a zip, a
 * .docx that is really a workbook, and a .xlsx carrying a VBA project all
 * die here, before any library touches them (advisory A2).
 *
 * For the OOXML formats (docx/xlsx are both ZIP-of-XML) we go one step
 * past the four-byte signature and walk the zip's central directory. That
 * gets us three things for ~70 lines and no dependency:
 *
 *   - the real part list, so `vbaProject.bin` is a rejection and a missing
 *     `word/document.xml` is a mislabelled file rather than a confusing
 *     parser error twenty seconds later;
 *   - declared uncompressed sizes, so an obvious decompression bomb is a
 *     400 instead of a worker we have to kill (defence in depth — the
 *     worker's heap ceiling is still the real backstop);
 *   - an entry count, because a legitimate Office document is dozens of
 *     parts, not thousands.
 *
 * We read the directory rather than unzipping: no entry is ever
 * decompressed here, and no filename from the archive is ever joined onto
 * a path (zip-slip has nowhere to land because nothing is written to disk).
 */

import path from "node:path";
import { ExtractError, type ExtractSourceType } from "./index.js";

export interface DetectedSource {
  sourceType: ExtractSourceType;
  /** Notes worth showing the user, e.g. an extension/content mismatch. */
  warnings: string[];
}

/** Extensions we will parse, mapped to the source type we report back. */
const ACCEPTED: Record<string, ExtractSourceType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".xls": "xls",
  ".csv": "csv",
};

/**
 * Macro-enabled and binary Office formats. These are rejected by name
 * before anything else, with their own message — "we don't run macros" is
 * a more useful thing to tell a user than "unsupported file".
 */
const MACRO_ENABLED = new Set([
  ".docm",
  ".dotm",
  ".xlsm",
  ".xltm",
  ".xlsb",
  ".pptm",
  ".potm",
]);

const PDF_MAGIC = Buffer.from("%PDF-", "latin1");
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
/** OLE2 compound file — the legacy binary .xls/.doc container. */
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * The %PDF- header is *usually* at offset 0 but the spec tolerates leading
 * junk, and pdf.js scans for it too. Matching that tolerance avoids
 * rejecting files that every other reader opens fine, while still being
 * nowhere near enough slack to smuggle a zip through.
 */
const PDF_HEADER_SEARCH_BYTES = 1024;

const MAX_ZIP_ENTRIES = 1024;
const MAX_ZIP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
/**
 * Office XML compresses extremely well — 50:1 on a text-heavy sheet is
 * ordinary — so this tripwire is set where only a purpose-built bomb sits,
 * not where a large-but-real spreadsheet does.
 */
const MAX_ZIP_RATIO = 1000;

export function detectSource(
  buffer: Buffer,
  filename: string,
  declaredMime: string,
): DetectedSource {
  const ext = safeExtension(filename);

  if (MACRO_ENABLED.has(ext)) {
    throw new ExtractError(
      "unsupported_file_type",
      "Macro-enabled Office files aren't accepted. Re-save it as .docx or .xlsx and try again.",
    );
  }

  const requested = ACCEPTED[ext] ?? fromMime(declaredMime);
  if (!requested) {
    throw new ExtractError(
      "unsupported_file_type",
      "We can read PDF, Word (.docx), Excel (.xlsx) and CSV files.",
    );
  }

  switch (requested) {
    case "pdf":
      return { sourceType: "pdf", warnings: verifyPdf(buffer) };
    case "docx":
      return { sourceType: "docx", warnings: verifyOoxml(buffer, "docx") };
    case "xlsx":
      return { sourceType: "xlsx", warnings: verifyOoxml(buffer, "xlsx") };
    case "xls":
      // A real legacy .xls is an OLE2 compound file, which exceljs cannot
      // read at all. We say so plainly instead of letting the user watch a
      // parse fail for reasons they can't act on. A ".xls" that is really
      // an OOXML workbook (Excel emits these more often than you'd think)
      // parses fine — we just keep the type the user sent.
      if (startsWith(buffer, OLE2_MAGIC)) {
        throw new ExtractError(
          "unsupported_file_type",
          "This is an old-format Excel file (.xls). Open it in Excel and save as .xlsx or CSV, then try again.",
        );
      }
      return { sourceType: "xls", warnings: verifyOoxml(buffer, "xlsx") };
    case "csv":
      return { sourceType: "csv", warnings: verifyPlainText(buffer) };
    default:
      throw new ExtractError(
        "unsupported_file_type",
        "We can read PDF, Word (.docx), Excel (.xlsx) and CSV files.",
      );
  }
}

/**
 * Extension only, from the basename, lower-cased. `path.basename` is used
 * to *discard* any directory component the client tried to smuggle in —
 * this value is a lookup key in a fixed table and is never joined onto a
 * filesystem path (W2).
 */
function safeExtension(filename: string): string {
  if (typeof filename !== "string") return "";
  const base = path.basename(filename.replace(/\\/g, "/").trim());
  return path.extname(base).toLowerCase();
}

/**
 * Browsers disagree about the MIME they attach (Windows reports CSV as
 * application/vnd.ms-excel often enough to matter), so this is a fallback
 * for a missing/odd extension only — never an override of one.
 */
function fromMime(declaredMime: string): ExtractSourceType | null {
  const mime = String(declaredMime ?? "").split(";")[0]?.trim().toLowerCase();
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
    case "text/csv":
    case "text/tab-separated-values":
      return "csv";
    default:
      return null;
  }
}

function verifyPdf(buffer: Buffer): string[] {
  const head = buffer.subarray(0, PDF_HEADER_SEARCH_BYTES);
  if (head.indexOf(PDF_MAGIC) === -1) {
    throw new ExtractError(
      "unsupported_file_type",
      "That file is named like a PDF but isn't one.",
    );
  }
  return [];
}

function verifyPlainText(buffer: Buffer): string[] {
  if (startsWith(buffer, ZIP_LOCAL_HEADER) || startsWith(buffer, OLE2_MAGIC)) {
    throw new ExtractError(
      "unsupported_file_type",
      "That file is named like a CSV but is a spreadsheet or archive. Rename it to its real extension and try again.",
    );
  }
  if (buffer.subarray(0, PDF_HEADER_SEARCH_BYTES).indexOf(PDF_MAGIC) === 0) {
    throw new ExtractError(
      "unsupported_file_type",
      "That file is named like a CSV but is a PDF. Rename it to its real extension and try again.",
    );
  }
  // A NUL byte early in the stream means this is binary, whatever it claims
  // to be. Real CSV — even UTF-8 with a BOM — never contains one.
  if (buffer.subarray(0, 8192).includes(0x00)) {
    throw new ExtractError(
      "unsupported_file_type",
      "That file is named like a CSV but contains binary data.",
    );
  }
  return [];
}

function verifyOoxml(buffer: Buffer, kind: "docx" | "xlsx"): string[] {
  if (!startsWith(buffer, ZIP_LOCAL_HEADER)) {
    throw new ExtractError(
      "unsupported_file_type",
      startsWith(buffer, OLE2_MAGIC)
        ? "That looks like an old-format Office file. Re-save it as .docx or .xlsx and try again."
        : "That file isn't a valid Office document.",
    );
  }

  const entries = readZipDirectory(buffer);
  const names = entries.map((e) => e.name);

  if (names.some((n) => n.toLowerCase().endsWith("vbaproject.bin"))) {
    throw new ExtractError(
      "unsupported_file_type",
      "That document contains macros. Re-save it without macros and try again.",
    );
  }
  if (!names.some((n) => n === "[Content_Types].xml")) {
    throw new ExtractError(
      "unsupported_file_type",
      "That file isn't a valid Office document.",
    );
  }

  const looksDocx = names.some((n) => n === "word/document.xml");
  const looksXlsx = names.some((n) => n === "xl/workbook.xml");
  const warnings: string[] = [];

  if (kind === "docx" && !looksDocx) {
    throw new ExtractError(
      "unsupported_file_type",
      looksXlsx
        ? "That file is named like a Word document but is a spreadsheet. Rename it to .xlsx and try again."
        : "That file isn't a readable Word document.",
    );
  }
  if (kind === "xlsx" && !looksXlsx) {
    throw new ExtractError(
      "unsupported_file_type",
      looksDocx
        ? "That file is named like a spreadsheet but is a Word document. Rename it to .docx and try again."
        : "That file isn't a readable Excel workbook.",
    );
  }

  const totalUncompressed = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (entries.length > MAX_ZIP_ENTRIES || totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new ExtractError(
      "unsupported_file_type",
      "That document is too large or too complex to read safely.",
    );
  }
  if (buffer.length > 0 && totalUncompressed / buffer.length > MAX_ZIP_RATIO) {
    throw new ExtractError(
      "unsupported_file_type",
      "That document is too large or too complex to read safely.",
    );
  }

  return warnings;
}

function startsWith(buffer: Buffer, magic: Buffer): boolean {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);
}

interface ZipEntry {
  name: string;
  uncompressedSize: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CD_HEADER_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;
const CD_HEADER_SIZE = 46;
/** Max zip comment length, so the EOCD can't be further back than this. */
const MAX_EOCD_SEARCH = EOCD_MIN_SIZE + 0xffff;
/** Sentinel meaning "the real value lives in a ZIP64 extra field". */
const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_SENTINEL_16 = 0xffff;

/**
 * Walk the zip central directory and return every entry's name + declared
 * uncompressed size. Nothing is decompressed and nothing is written; this
 * is a read of the archive's own table of contents.
 *
 * ZIP64 archives are rejected rather than supported: an Office document
 * under our 10 MB upload cap has no legitimate reason to need 64-bit
 * offsets, so encountering one means the file is either broken or trying
 * something. Rejecting is both safer and less code than a second parser.
 */
function readZipDirectory(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer);
  if (eocd < 0) {
    throw new ExtractError(
      "unsupported_file_type",
      "That file isn't a valid Office document.",
    );
  }

  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);

  if (
    totalEntries === ZIP64_SENTINEL_16 ||
    cdSize === ZIP64_SENTINEL_32 ||
    cdOffset === ZIP64_SENTINEL_32
  ) {
    throw new ExtractError(
      "unsupported_file_type",
      "That document is too large or too complex to read safely.",
    );
  }
  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new ExtractError(
      "unsupported_file_type",
      "That document is too large or too complex to read safely.",
    );
  }
  if (cdOffset + cdSize > buffer.length) {
    throw new ExtractError(
      "unsupported_file_type",
      "That file isn't a valid Office document.",
    );
  }

  const entries: ZipEntry[] = [];
  let at = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (at + CD_HEADER_SIZE > buffer.length) break;
    if (buffer.readUInt32LE(at) !== CD_HEADER_SIGNATURE) break;

    const uncompressedSize = buffer.readUInt32LE(at + 24);
    const nameLen = buffer.readUInt16LE(at + 28);
    const extraLen = buffer.readUInt16LE(at + 30);
    const commentLen = buffer.readUInt16LE(at + 32);
    const nameStart = at + CD_HEADER_SIZE;
    if (nameStart + nameLen > buffer.length) break;

    entries.push({
      name: buffer.toString("utf8", nameStart, nameStart + nameLen),
      // A ZIP64 entry reports 0xFFFFFFFF here; treat it as "bigger than we
      // are willing to consider" so the size guard above trips on it.
      uncompressedSize:
        uncompressedSize === ZIP64_SENTINEL_32
          ? MAX_ZIP_UNCOMPRESSED_BYTES + 1
          : uncompressedSize,
    });
    at = nameStart + nameLen + extraLen + commentLen;
  }

  if (entries.length === 0) {
    throw new ExtractError(
      "unsupported_file_type",
      "That file isn't a valid Office document.",
    );
  }
  return entries;
}

/** Scan backwards for the end-of-central-directory signature. */
function findEocd(buffer: Buffer): number {
  const floor = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let at = buffer.length - EOCD_MIN_SIZE; at >= floor; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  return -1;
}
