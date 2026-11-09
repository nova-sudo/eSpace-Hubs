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
  return typeof s === "string"
    ? repairMojibake(s).trim().replace(/^"+|"+$/g, "").trim()
    : "";
}

// Windows-1252's 0x80–0x9F block, which differs from Latin-1's C1 controls.
// UTF-8 text mis-decoded as 1252 carries these (e.g. "≥" → "â‰¥").
const CP1252_HIGH = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/**
 * Undo UTF-8 text that was decoded as Latin-1 / Windows-1252 somewhere
 * upstream (a BOM-less CSV, or a sheet Zoho wrote that way): "â‰¥ 85%"
 * → "≥ 85%". Only applied when every char maps back to a single byte AND
 * those bytes form valid UTF-8 containing a multi-byte sequence — genuine
 * Latin-1 text ("café") is never valid UTF-8 as bytes, so it's left alone.
 */
export function repairMojibake(s) {
  if (typeof s !== "string" || !/[\u00c2-\u00f4]/.test(s)) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c <= 0xff) bytes[i] = c;
    else if (CP1252_HIGH[c] !== undefined) bytes[i] = CP1252_HIGH[c];
    else return s;
  }
  try {
    const out = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return out !== s ? out : s;
  } catch {
    return s;
  }
}

/**
 * SheetJS reads text files (CSV, Zoho's HTML-flavoured ".xls") from a byte
 * array as Windows-1252 unless there's a BOM, which garbles every "≥", "–"
 * and curly quote. Decode text files as UTF-8 ourselves when they are valid
 * UTF-8; binary workbooks (XLSX zip, legacy OLE XLS) go through unchanged.
 */
function readWorkbook(buffer) {
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (!isZip && !isOle) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer);
      return XLSX.read(text, { type: "string" });
    } catch {
      // Not valid UTF-8 — a genuine 1252 file; let SheetJS handle it.
    }
  }
  return XLSX.read(buffer, { type: "array" });
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
 * Returns `{ type, detectedType, rows, filename, sheet?, warning? }`.
 *
 * `type` is the level the rows were parsed AS; `detectedType` is what the
 * header sniff said (they differ only under `forceType`). Pass
 * `{ forceType: "l1" | "l2" }` to override the sniff — used by the import
 * panel's per-file level toggle. A forced parse takes the first sheet
 * whose rows survive the forced normalizer, so flipping is only possible
 * for files that actually carry the other level's columns; a forced parse
 * with zero surviving rows returns a warning and an empty `rows`.
 */
export async function parseImportFile(file, { forceType } = {}) {
  const filename = file.name;
  const buffer = await file.arrayBuffer();

  let workbook;
  try {
    workbook = readWorkbook(buffer);
  } catch (err) {
    return {
      type: null,
      detectedType: null,
      rows: [],
      filename,
      warning: `${filename}: ${err.message}`,
    };
  }

  // Zoho's L2 XLS has two sheets: Sheet 1 (data) and "Comments". We want
  // whichever sheet has recognizable KRA columns — or, when forcing a
  // level, whichever sheet yields rows under that level's normalizer.
  let best = null;
  let detectedType = null;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (rows.length === 0) continue;
    const sniffed = detectType(Object.keys(rows[0]));
    if (sniffed && !detectedType) detectedType = sniffed;
    if (forceType) {
      const normalized = rows
        .map(forceType === "l1" ? normalizeL1 : normalizeL2)
        .filter(Boolean);
      if (normalized.length > 0) {
        best = { type: forceType, rows: normalized, sheetName: name };
        break;
      }
    } else if (sniffed) {
      best = {
        type: sniffed,
        rows: rows.map(sniffed === "l1" ? normalizeL1 : normalizeL2).filter(Boolean),
        sheetName: name,
      };
      break;
    }
  }

  if (!best) {
    return {
      type: null,
      detectedType,
      rows: [],
      filename,
      warning: forceType
        ? `${filename}: no ${forceType.toUpperCase()} rows found — the file doesn't carry ${forceType.toUpperCase()} columns`
        : `${filename}: couldn't recognize L1 or L2 columns`,
    };
  }

  return {
    type: best.type,
    detectedType,
    rows: best.rows,
    filename,
    sheet: best.sheetName,
  };
}

/**
 * Choose each imported row's id. A Zoho link id is the stable choice —
 * except that the L1 export stamps the EMPLOYEE's link id on every KRA
 * row, so a link id shared by several rows is no id at all. Those rows
 * fall back to their goal code (stable across re-imports), then to a
 * random id. Every id handed out is unique within the import.
 */
function importIdPicker(level, rows) {
  const seen = new Map();
  for (const r of rows) {
    const id = r.sourceId || "";
    if (id) seen.set(id, (seen.get(id) || 0) + 1);
  }
  const taken = new Set();
  const fresh = () => `${level}-${Math.random().toString(36).slice(2, 9)}`;
  return (r) => {
    const candidates = [
      seen.get(r.sourceId) === 1 ? r.sourceId : "",
      r.code ? `${level}-${r.code}` : "",
    ];
    let id = candidates.find((c) => c && !taken.has(c)) || fresh();
    while (taken.has(id)) id = fresh();
    taken.add(id);
    return id;
  };
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
  const l1Id = importIdPicker("l1", l1Rows);
  const l2Id = importIdPicker("l2", l2Rows);

  const l1s = l1Rows.map((r) => {
    const l1 = {
      id: l1Id(r),
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
      id: l2Id(l2),
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

/**
 * Re-home orphaned L2s onto user-chosen parents. `assignments` maps an
 * orphan's l2 id → the target l1 id; ids not present (or pointing at an
 * l1 that isn't in the tree) leave that orphan orphaned, so stale
 * assignments from a previous parse are harmless. Pure — returns a fresh
 * `{ tree, unmatchedL2s, stats }` without mutating the input.
 */
export function applyOrphanAssignments(merged, assignments = {}) {
  const { tree, unmatchedL2s, stats } = merged;
  if (!unmatchedL2s?.length || Object.keys(assignments).length === 0) {
    return merged;
  }

  const l1s = tree.l1s.map((l1) => ({ ...l1, l2s: [...l1.l2s] }));
  const byId = new Map(l1s.map((l1) => [l1.id, l1]));

  const stillOrphaned = [];
  let moved = 0;
  for (const orphan of unmatchedL2s) {
    const target = byId.get(assignments[orphan.id]);
    if (target) {
      const { parentTitle: _dropped, ...l2Entry } = orphan;
      target.l2s.push(l2Entry);
      moved++;
    } else {
      stillOrphaned.push(orphan);
    }
  }

  return {
    tree: { l1s },
    unmatchedL2s: stillOrphaned,
    stats: {
      ...stats,
      l2Matched: stats.l2Matched + moved,
      l2Unmatched: stats.l2Unmatched - moved,
    },
  };
}
