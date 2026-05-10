import * as XLSX from "xlsx";

/**
 * Parsers for Zoho People "KRA / Goals" exports.
 *
 * Zoho offers two relevant exports out of the Performance Management module:
 *
 *   L1 View  →  CSV with columns:
 *               ZOHO_LINK_ID, Employee, L1, "KRA Description", Weightage,
 *               Added By, Added time, Modified By, Modified time
 *
 *   L2 View  →  XLS (or CSV) with columns:
 *               ZOHO_LINK_ID, "L2 Name", "Due Date", Priority, Description,
 *               Progress, "Assigned by", "Assigned to", "Start Date", L1,
 *               Job, "Is Archived", Added/Modified tracking, Department,
 *               Weightage, "KRA weightage"
 *
 * Import strategy:
 *   1. Detect file type by column signature
 *   2. Normalize each row to our internal L1 / L2 shape
 *   3. Merge: link every L2 to its parent L1 by exact title match; fall
 *      back to matching the "R-L0-3-PSCS-L1-06" style code prefix, since
 *      stray quotes or trailing whitespace can break exact equality
 */

const L1_CODE_RE = /\b([A-Z]{1,3}-L0-\d+-[A-Z]+-L1-\d+)\b/;
const L2_CODE_RE = /\b([A-Z]{1,3}-L0-\d+-[A-Z]+-L2-\d+(?:-\d+)?)\b/;

function trim(s) {
  return typeof s === "string" ? s.trim().replace(/^"+|"+$/g, "").trim() : "";
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sniff file type from header row.
 * Returns `"l1"`, `"l2"`, or `null` if unrecognized.
 */
function detectType(columns) {
  const set = new Set(columns.map((c) => String(c).toLowerCase().trim()));
  if (set.has("l2 name")) return "l2";
  if (set.has("l1") && set.has("kra description")) return "l1";
  return null;
}

function normalizeL1(row) {
  const title = trim(row.L1);
  if (!title) return null;
  const codeMatch = title.match(L1_CODE_RE);
  const code = codeMatch ? codeMatch[1] : "";
  // Strip the code prefix from the displayed title so it reads cleanly
  // (original code is preserved in its own field).
  const stripped = code ? title.replace(code, "").replace(/^[\s:-]+/, "").trim() : title;
  return {
    sourceId: String(row.ZOHO_LINK_ID || "").trim(),
    code,
    title: stripped,
    fullTitle: title, // kept for L2-parent matching
    rubric: trim(row["KRA Description"]),
    weightage: toNumber(row.Weightage),
  };
}

function normalizeL2(row) {
  const title = trim(row["L2 Name"]);
  if (!title) return null;
  const codeMatch = title.match(L2_CODE_RE);
  const code = codeMatch ? codeMatch[1] : "";
  // L2 names come through as "CODE: Human Title" — drop the "CODE:" prefix.
  const stripped = code
    ? title.replace(code, "").replace(/^[\s:-]+/, "").trim()
    : title;
  return {
    sourceId: String(row.ZOHO_LINK_ID || "").trim(),
    code,
    title: stripped,
    parentTitle: trim(row.L1),
    // Zoho has both "L2 Name" (title) and "Description" (longer free-text).
    // Our schema now separates `description` (context) from `rubric` (the
    // Not/Achieved/Over/Role-model criteria). Zoho only supplies the former,
    // so we put it in `description` and leave `rubric` empty for the user
    // to fill in the editor.
    description: trim(row.Description),
    rubric: "",
    weightage: toNumber(row.Weightage),
    priority: normalizePriority(row.Priority),
    startDate: toIsoDate(row["Start Date"]),
    dueDate: toIsoDate(row["Due Date"]),
    // Progress is intentionally NOT captured — the AI Analyst derives it now.
  };
}

/** Zoho uses "Low" / "Medium" / "High" / "". Coerce to our lowercase enum. */
function normalizePriority(raw) {
  const v = trim(raw).toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return "";
}

/**
 * Accept Zoho's messy date cells. Excel/CSV dates arrive as:
 *   - a Date object (rare)
 *   - a string like "2026-04-21" / "21-Apr-2026" / "4/21/2026"
 *   - an Excel serial number (days since 1899-12-30)
 * Normalize to ISO "YYYY-MM-DD"; unparseable → "".
 */
function toIsoDate(raw) {
  if (raw == null || raw === "") return "";
  if (raw instanceof Date && !isNaN(raw)) {
    return raw.toISOString().slice(0, 10);
  }
  // Excel serial number → JS Date. Excel's epoch is 1899-12-30 (due to the
  // 1900 leap-year bug), so we offset from there.
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    const ms = excelEpoch + raw * 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  const parsed = new Date(s);
  if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10);
  return "";
}

/**
 * Parse a File or Blob (CSV / XLS / XLSX) into normalized rows.
 * Returns `{ type, rows, filename, warning? }`.
 */
export async function parseImportFile(file) {
  const filename = file.name;
  const buffer = await file.arrayBuffer();

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch (err) {
    return { type: null, rows: [], filename, warning: `${filename}: ${err.message}` };
  }

  // Zoho's L2 XLS has two sheets: Sheet 1 (data) and "Comments". We want
  // whichever sheet has recognizable KRA columns.
  let best = null;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (rows.length === 0) continue;
    const type = detectType(Object.keys(rows[0]));
    if (type) {
      best = { type, rows, sheetName: name };
      break;
    }
  }

  if (!best) {
    return {
      type: null,
      rows: [],
      filename,
      warning: `${filename}: couldn't recognize L1 or L2 columns`,
    };
  }

  const normalized = best.rows
    .map(best.type === "l1" ? normalizeL1 : normalizeL2)
    .filter(Boolean);

  return { type: best.type, rows: normalized, filename, sheet: best.sheetName };
}

/**
 * Merge parsed L1 rows and L2 rows into the goal-tree shape used by
 * `features/goals/goals-store`. Matches each L2 to its parent L1 by exact
 * title; falls back to matching by L1 code prefix if exact match fails.
 *
 * Returns `{ tree, unmatchedL2s, stats }`.
 */
export function mergeImport({ l1Rows = [], l2Rows = [] }) {
  const byTitle = new Map();
  const byCode = new Map();

  const l1s = l1Rows.map((r) => {
    const l1 = {
      id: r.sourceId || `l1-${Math.random().toString(36).slice(2, 9)}`,
      code: r.code,
      title: r.title,
      description: "",
      rubric: r.rubric,
      weightage: r.weightage,
      category: "",
      l2s: [],
    };
    if (r.fullTitle) byTitle.set(r.fullTitle, l1);
    if (r.code) byCode.set(r.code, l1);
    return l1;
  });

  const unmatchedL2s = [];

  for (const l2 of l2Rows) {
    let parent = byTitle.get(l2.parentTitle);
    if (!parent && l2.parentTitle) {
      // Try matching by L1 code prefix embedded in the parent title string
      const m = l2.parentTitle.match(L1_CODE_RE);
      if (m) parent = byCode.get(m[1]);
    }

    const l2Entry = {
      id: l2.sourceId || `l2-${Math.random().toString(36).slice(2, 9)}`,
      code: l2.code,
      title: l2.title,
      description: l2.description,
      rubric: l2.rubric,
      weightage: l2.weightage,
      priority: l2.priority,
      startDate: l2.startDate,
      dueDate: l2.dueDate,
      category: "",
    };

    if (parent) {
      parent.l2s.push(l2Entry);
    } else {
      unmatchedL2s.push({ ...l2Entry, parentTitle: l2.parentTitle });
    }
  }

  return {
    tree: { l1s },
    unmatchedL2s,
    stats: {
      l1Count: l1s.length,
      l2Matched: l2Rows.length - unmatchedL2s.length,
      l2Unmatched: unmatchedL2s.length,
    },
  };
}
