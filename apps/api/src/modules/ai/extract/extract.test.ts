/**
 * Extraction tests. Run with:
 *
 *   npx tsx --test src/modules/ai/extract/extract.test.ts
 *
 * Every case here goes through the real `extractDocument()`, which means
 * every passing parse also proves the worker thread spawned, loaded a
 * TypeScript entry point under tsx, and reported back — the failure mode
 * that only shows up in one of dev/prod is the main thing this suite is
 * defending.
 *
 * Fixtures are built in memory, never checked in. The XLSX comes from
 * exceljs' own writer (read-what-you-write is the strongest signal we can
 * get cheaply), and the DOCX comes from the ~50-line STORED-entry zip
 * writer at the bottom of this file. Hand-writing the zip is deliberate:
 * it keeps binary blobs out of the repo, and it means detect.ts's central
 * directory reader is exercised against bytes this file laid out by hand
 * rather than against whatever a library happened to emit.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  extractDocument,
  ExtractError,
  MAX_EXTRACTED_CHARS,
  type ExtractErrorCode,
} from "./index.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function rejectsWith(code: ExtractErrorCode) {
  return (err: unknown): boolean => {
    assert.ok(err instanceof ExtractError, `expected ExtractError, got ${String(err)}`);
    assert.equal(err.code, code);
    return true;
  };
}

/* ── Magic bytes beat the filename ─────────────────────────────────── */

test("rejects a workbook that has been renamed to .pdf", async () => {
  const workbook = await makeWorkbook();
  await assert.rejects(
    () => extractDocument(workbook, "totally-a-plan.pdf", "application/pdf"),
    rejectsWith("unsupported_file_type"),
  );
});

test("rejects a workbook that has been renamed to .csv", async () => {
  const workbook = await makeWorkbook();
  await assert.rejects(
    () => extractDocument(workbook, "plan.csv", "text/csv"),
    rejectsWith("unsupported_file_type"),
  );
});

test("rejects a workbook that has been renamed to .docx", async () => {
  // Same zip signature, same [Content_Types].xml — only the part list
  // tells these apart, which is why detect.ts reads the directory.
  const workbook = await makeWorkbook();
  await assert.rejects(
    () => extractDocument(workbook, "plan.docx", DOCX_MIME),
    rejectsWith("unsupported_file_type"),
  );
});

test("rejects a legacy OLE2 .xls instead of failing inside the parser", async () => {
  const ole2 = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(2048, 0x41),
  ]);
  await assert.rejects(
    () => extractDocument(ole2, "old-plan.xls", "application/vnd.ms-excel"),
    rejectsWith("unsupported_file_type"),
  );
});

/* ── Type allow-list ───────────────────────────────────────────────── */

test("rejects an unsupported file type", async () => {
  const text = Buffer.from("Week 1 - focus: onboarding\n", "utf8");
  await assert.rejects(
    () => extractDocument(text, "notes.txt", "text/plain"),
    rejectsWith("unsupported_file_type"),
  );
});

test("rejects a macro-enabled document by extension", async () => {
  const docx = makeDocx();
  await assert.rejects(
    () => extractDocument(docx, "plan.docm", DOCX_MIME),
    rejectsWith("unsupported_file_type"),
  );
});

test("rejects an OOXML package carrying a VBA project", async () => {
  const withMacros = makeDocx([
    { name: "word/vbaProject.bin", data: Buffer.from([0x00, 0x01, 0x02]) },
  ]);
  await assert.rejects(
    () => extractDocument(withMacros, "plan.docx", DOCX_MIME),
    rejectsWith("unsupported_file_type"),
  );
});

/* ── Row structure survives ────────────────────────────────────────── */

test("CSV keeps each record on one line", async () => {
  const csv = [
    "Month,Deliverable,Due date",
    "Month 1,Complete onboarding checklist,2026-08-31",
    'Month 2,"Shadow a code review, then write one",2026-09-30',
  ].join("\n");

  const result = await extractDocument(Buffer.from(csv, "utf8"), "idp.csv", "text/csv");

  assert.equal(result.sourceType, "csv");
  assert.equal(result.truncated, false);
  const lines = result.text.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "Month 1 | Complete onboarding checklist | 2026-08-31");
  // The quoted comma must not have split the field into two cells.
  assert.equal(lines[2], "Month 2 | Shadow a code review, then write one | 2026-09-30");
  assert.ok(result.info.some((w) => w.includes("comma-separated")));
  // A clean read must raise NO warning — the amber banner has to stay rare
  // to mean anything. This is the regression guard for that.
  assert.deepEqual(result.warnings, []);
});

test("TSV is detected and keeps each record on one line", async () => {
  const tsv = [
    "Week\tFocus\tDeliverable",
    "Week 1\tFoundation, part one\tSpec template",
    "Week 2\tPilot\tFirst spec merged",
  ].join("\n");

  const result = await extractDocument(Buffer.from(tsv, "utf8"), "plan.csv", "text/csv");

  const lines = result.text.split("\n");
  assert.equal(lines.length, 3);
  // A comma inside a cell must not have been mistaken for the delimiter.
  assert.equal(lines[1], "Week 1 | Foundation, part one | Spec template");
  assert.ok(result.info.some((w) => w.includes("tab-separated")));
  assert.deepEqual(result.warnings, []);
});

test("XLSX keeps each row on one line, with dates as ISO", async () => {
  const workbook = await makeWorkbook();

  const result = await extractDocument(workbook, "idp.xlsx", XLSX_MIME);

  assert.equal(result.sourceType, "xlsx");
  assert.ok(result.text.includes("Sheet: IDP"));
  assert.ok(
    result.text.includes("Month 1 | Complete onboarding checklist | 2026-08-31"),
    `row structure lost:\n${result.text}`,
  );
  assert.ok(result.info.some((w) => /Read 1 sheet and 3 rows\./.test(w)));
  assert.deepEqual(result.warnings, []);
});

test("PDF text is extracted, and the parse survives worker teardown", async () => {
  // Also a regression guard: pdfjs' eager `@napi-rs/canvas` load used to
  // segfault the whole process when this worker tore down. If pdf.ts ever
  // stops stubbing it out, this test takes the runner down with it rather
  // than failing quietly.
  const pdf = makePdf([
    "13-Week SDD Adoption Plan",
    "Week 1 - Focus: Foundation",
    "Week 2 - Focus: Pilot",
  ]);

  const result = await extractDocument(pdf, "plan.pdf", "application/pdf");

  assert.equal(result.sourceType, "pdf");
  assert.ok(result.text.includes("13-Week SDD Adoption Plan"));
  assert.ok(result.text.includes("Week 2 - Focus: Pilot"));
  assert.ok(result.info.some((w) => w.includes("Read 1 page")));
  assert.deepEqual(result.warnings, []);
});

test("DOCX tables survive as rows, and the table count is reported", async () => {
  const docx = makeDocx();

  const result = await extractDocument(docx, "plan.docx", DOCX_MIME);

  assert.equal(result.sourceType, "docx");
  assert.ok(result.text.includes("6-Month IDP"));
  assert.ok(
    result.text.includes("Month 1 | Complete onboarding checklist | 2026-08-31"),
    `table row was flattened:\n${result.text}`,
  );
  assert.ok(
    result.text.includes("Month 2 | Shadow a code review | 2026-09-30"),
    `table row was flattened:\n${result.text}`,
  );
  // Prose outside the table is still plain prose.
  assert.ok(result.text.includes("Reviewed monthly with my manager."));
  assert.ok(
    result.info.some((w) => w.includes("Found 1 table") && w.includes("3 rows")),
    `table count not surfaced: ${JSON.stringify(result.info)}`,
  );
});

/* ── Caps and empty output ─────────────────────────────────────────── */

test("truncates at the extracted-character cap and says so", async () => {
  const rows = ["Month,Deliverable,Due date"];
  for (let i = 1; i <= 1_500; i += 1) {
    rows.push(`Month ${i},Deliverable number ${i} for the plan,2026-08-31`);
  }
  const csv = Buffer.from(rows.join("\n"), "utf8");
  assert.ok(csv.length > MAX_EXTRACTED_CHARS * 2, "fixture must exceed the cap");

  const result = await extractDocument(csv, "long.csv", "text/csv");

  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= MAX_EXTRACTED_CHARS);
  assert.ok(result.warnings.some((w) => w.includes("20,000")));
  // Truncation must not leave a half-row that reads like real data.
  const lastLine = result.text.split("\n").pop() ?? "";
  assert.match(lastLine, /^Month \d+ \| Deliverable number \d+ for the plan \| 2026-08-31$/);
});

test("a document with no readable text fails loudly rather than returning nothing", async () => {
  const blank = Buffer.from("\n\n   \n", "utf8");
  await assert.rejects(
    () => extractDocument(blank, "empty.csv", "text/csv"),
    rejectsWith("extract_failed"),
  );
});

/* ── Fixtures ──────────────────────────────────────────────────────── */

async function makeWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("IDP");
  sheet.addRow(["Month", "Deliverable", "Due date"]);
  sheet.addRow(["Month 1", "Complete onboarding checklist", new Date("2026-08-31T00:00:00Z")]);
  sheet.addRow(["Month 2", "Shadow a code review", new Date("2026-09-30T00:00:00Z")]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * A single-page PDF with a real (if tiny) xref table, built by hand so no
 * binary fixture has to live in the repo.
 */
function makePdf(lines: string[]): Buffer {
  const backslash = String.fromCharCode(92);
  const escape = (value: string): string => {
    let out = "";
    for (const ch of value) {
      if (ch === "(" || ch === ")" || ch === backslash) out += backslash;
      out += ch;
    }
    return out;
  };

  const content =
    "BT /F1 12 Tf 14 TL 72 720 Td\n" +
    lines.map((line) => `(${escape(line)}) Tj T*`).join("\n") +
    "\nET\n";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function makeDocx(extra: ZipEntry[] = []): Buffer {
  const paragraph = (text: string): string =>
    `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (text: string): string => `<w:tc><w:tcPr/>${paragraph(text)}</w:tc>`;
  const tableRow = (cells: string[]): string => `<w:tr>${cells.map(cell).join("")}</w:tr>`;

  const table =
    "<w:tbl><w:tblPr/><w:tblGrid/>" +
    tableRow(["Month", "Deliverable", "Due date"]) +
    tableRow(["Month 1", "Complete onboarding checklist", "2026-08-31"]) +
    tableRow(["Month 2", "Shadow a code review", "2026-09-30"]) +
    "</w:tbl>";

  const document =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraph("6-Month IDP") +
    table +
    paragraph("Reviewed monthly with my manager.") +
    "</w:body></w:document>";

  const contentTypes =
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    "</Types>";

  const rels =
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  return writeZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
    ...extra,
  ]);
}

/** Minimal STORED-only zip writer — enough for an OOXML package. */
function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);

    const localBlock = Buffer.concat([local, name, entry.data]);
    locals.push(localBlock);
    centrals.push(Buffer.concat([central, name]));
    offset += localBlock.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, eocd]);
}

let crcTable: Uint32Array | null = null;

function crc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[i] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
