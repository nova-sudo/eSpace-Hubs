#!/usr/bin/env node
/**
 * import-zoho-goals.mjs — one-shot importer for Zoho People L1 + L2
 * exports into the goals collection.
 *
 * Why a standalone script vs. running the UI importer:
 *   The UI importer at /[hub]/goals does the same parsing client-side
 *   and PUTs the tree via the API. For someone who already has the
 *   files on disk and just wants the tree imported under a specific
 *   account (typically during dev/setup), running the script from the
 *   repo root is faster than logging in + clicking through the UI.
 *
 * What it does:
 *   1. Reads the two Zoho CSV exports (L1 view, L2 view).
 *   2. Parses them with a small RFC4180 parser (handles quoted
 *      newlines + escaped quotes — Zoho's KRA descriptions span
 *      multiple lines, so naive split-by-comma is broken).
 *   3. Normalises into the in-tree shape used by db/types.ts —
 *      same logic mirrored from apps/web's import-parser.js so the
 *      result is byte-identical to a UI import.
 *   4. Links each L2 to its parent L1 by exact title match, falling
 *      back to L1-code-prefix match (Zoho sometimes inserts stray
 *      quotes that break exact equality).
 *   5. Upserts into `goals` keyed by (orgId, userId) — replaces the
 *      whole tree, matching the API's PUT semantics.
 *
 * Args:
 *   --email <addr>   target user (required). Resolved to (userId,
 *                     orgId) by a users-collection lookup.
 *   --l1 <path>      path to the Zoho L1 CSV (default: prompts)
 *   --l2 <path>      path to the Zoho L2 CSV
 *   --dry-run        log the parsed tree, don't write
 *   --mongo <uri>    override Mongo URI (default localhost:27017)
 *   --db <name>      override DB name (default devhub-dev)
 *
 * Requirements:
 *   - Node 18+ (built-in fetch + ESM)
 *   - The mongodb npm package available somewhere reachable. The
 *     script tries the api workspace first, then falls back to the
 *     repo root node_modules.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// Resolve `mongodb` from wherever it's installed — apps/api is the
// guaranteed host (it's a runtime dep of the API server), but the
// workspace root often hoists it too. Try both before giving up.
const requireFromHere = createRequire(import.meta.url);
function loadMongo() {
  const candidates = [
    path.join(REPO_ROOT, "apps/api/node_modules/mongodb"),
    path.join(REPO_ROOT, "node_modules/mongodb"),
  ];
  for (const c of candidates) {
    try {
      return requireFromHere(c);
    } catch {
      /* try next */
    }
  }
  try {
    return requireFromHere("mongodb");
  } catch (e) {
    console.error(
      "✗ couldn't find the 'mongodb' package. Run `npm install` " +
        "in the repo root (or in apps/api) and re-try.",
    );
    process.exit(1);
  }
}
const { MongoClient, ObjectId } = loadMongo();

const GOALS_SCHEMA_VERSION = 2;
const STORAGE_KEY = "goals";
const USERS_KEY = "users";

// ─── argv ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    email: null,
    l1: null,
    l2: null,
    dryRun: false,
    mongoUri: "mongodb://localhost:27017",
    dbName: "devhub-dev",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--email") out.email = argv[++i];
    else if (a === "--l1") out.l1 = argv[++i];
    else if (a === "--l2") out.l2 = argv[++i];
    else if (a === "--mongo") out.mongoUri = argv[++i];
    else if (a === "--db") out.dbName = argv[++i];
    else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`✗ unknown argument: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/import-zoho-goals.mjs [flags]

Required:
  --email <addr>     user email to import under
  --l1 <path>        path to Zoho L1 CSV
  --l2 <path>        path to Zoho L2 CSV

Optional:
  --dry-run          parse + summarise, don't write to Mongo
  --mongo <uri>      Mongo URI (default mongodb://localhost:27017)
  --db <name>        Mongo DB name (default devhub-dev)
  -h, --help         show this help
`);
}

// ─── CSV parser (RFC4180-ish) ────────────────────────────────────

/**
 * Parse a CSV string into an array of row objects keyed by the
 * column header in row 1. Handles:
 *   - quoted fields wrapping `"..."`
 *   - doubled quotes (`""`) escaping a single literal quote
 *   - newlines inside quoted fields
 *   - trailing CR on Windows line endings
 *
 * Doesn't handle: BOM markers (we strip them upfront), comments,
 * or delimiters other than `,`. Sufficient for Zoho's exports.
 */
function parseCsv(text) {
  // Strip UTF-8 BOM if present so the first column name doesn't
  // begin with ﻿.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Doubled quote → literal quote
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        // Finish row. If \r\n, skip the \n on next iter.
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else {
        field += ch;
      }
    }
  }
  // Don't drop the last row if file doesn't end with newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = cols[i] ?? "";
    return obj;
  });
}

// ─── normalisers (mirror of apps/web/src/features/goals/import-parser.js)

const L1_CODE_RE = /\b([A-Z]{1,3}-L0-\d+-[A-Z]+-L1-\d+)\b/;
const L2_CODE_RE = /\b([A-Z]{1,3}-L0-\d+-[A-Z]+-L2-\d+(?:-\d+)?)\b/;

function trim(s) {
  return typeof s === "string" ? s.trim().replace(/^"+|"+$/g, "").trim() : "";
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizePriority(raw) {
  const v = trim(raw).toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return "";
}

function toIsoDate(raw) {
  if (raw == null || raw === "") return "";
  const s = String(raw).trim();
  // Zoho's CSV exports dates like "31/12/2026" (dd/mm/yyyy) — not
  // a format Date() parses correctly cross-platform. Detect that
  // shape and rearrange before handing to Date.
  const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10);
  return "";
}

function normalizeL1(row) {
  const title = trim(row.L1);
  if (!title) return null;
  const codeMatch = title.match(L1_CODE_RE);
  const code = codeMatch ? codeMatch[1] : "";
  const stripped = code
    ? title.replace(code, "").replace(/^[\s:-]+/, "").trim()
    : title;
  return {
    sourceId: String(row.ZOHO_LINK_ID || "").trim(),
    code,
    title: stripped,
    fullTitle: title,
    rubric: trim(row["KRA Description"]),
    weightage: toNumber(row.Weightage),
  };
}

function normalizeL2(row) {
  const title = trim(row["L2 Name"]);
  if (!title) return null;
  const codeMatch = title.match(L2_CODE_RE);
  const code = codeMatch ? codeMatch[1] : "";
  const stripped = code
    ? title.replace(code, "").replace(/^[\s:-]+/, "").trim()
    : title;
  return {
    sourceId: String(row.ZOHO_LINK_ID || "").trim(),
    code,
    title: stripped,
    parentTitle: trim(row.L1),
    description: trim(row.Description),
    rubric: "",
    weightage: toNumber(row.Weightage),
    priority: normalizePriority(row.Priority),
    startDate: toIsoDate(row["Start Date"]),
    dueDate: toIsoDate(row["Due Date"]),
  };
}

function mergeImport({ l1Rows, l2Rows }) {
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
    if (parent) parent.l2s.push(l2Entry);
    else unmatchedL2s.push({ ...l2Entry, parentTitle: l2.parentTitle });
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

// ─── main ─────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Validate required args before touching Mongo so we can show a
  // help line if the caller mistyped.
  const missing = [];
  if (!args.email) missing.push("--email");
  if (!args.l1) missing.push("--l1");
  if (!args.l2) missing.push("--l2");
  if (missing.length) {
    console.error(`✗ missing required args: ${missing.join(", ")}`);
    printHelp();
    process.exit(1);
  }
  if (!existsSync(args.l1)) {
    console.error(`✗ L1 file not found: ${args.l1}`);
    process.exit(1);
  }
  if (!existsSync(args.l2)) {
    console.error(`✗ L2 file not found: ${args.l2}`);
    process.exit(1);
  }

  // Parse + normalise both files.
  const l1Raw = readFileSync(args.l1, "utf8");
  const l2Raw = readFileSync(args.l2, "utf8");
  const l1Rows = parseCsv(l1Raw).map(normalizeL1).filter(Boolean);
  const l2Rows = parseCsv(l2Raw).map(normalizeL2).filter(Boolean);
  const { tree, unmatchedL2s, stats } = mergeImport({ l1Rows, l2Rows });

  console.log(`\n  parsed:`);
  console.log(`    L1: ${stats.l1Count} (from ${args.l1})`);
  console.log(`    L2: ${stats.l2Matched + stats.l2Unmatched} (from ${args.l2})`);
  console.log(`         · ${stats.l2Matched} linked to a parent L1`);
  console.log(`         · ${stats.l2Unmatched} unmatched (parent missing in L1 file)`);

  if (unmatchedL2s.length > 0) {
    console.log(`\n  unmatched L2s (will not import):`);
    for (const u of unmatchedL2s) {
      console.log(`    · ${u.title} → expected parent: ${u.parentTitle.slice(0, 80)}…`);
    }
  }

  console.log(`\n  tree shape:`);
  for (const l1 of tree.l1s) {
    console.log(
      `    L1 [${l1.code || l1.id}] ${l1.title.slice(0, 60)} (${l1.weightage}%) — ${l1.l2s.length} L2s`,
    );
    for (const l2 of l1.l2s) {
      console.log(
        `       L2 [${l2.code || l2.id}] ${l2.title.slice(0, 60)} (${l2.weightage}%, ${l2.priority || "no priority"})`,
      );
    }
  }

  if (args.dryRun) {
    console.log(`\n  dry-run — nothing written. Re-run without --dry-run.`);
    return;
  }

  // Connect, look up user, upsert.
  console.log(`\n  connecting to ${args.mongoUri}/${args.dbName}…`);
  const client = new MongoClient(args.mongoUri);
  await client.connect();
  try {
    const db = client.db(args.dbName);
    const users = db.collection(USERS_KEY);
    const goals = db.collection(STORAGE_KEY);

    const user = await users.findOne({
      email: { $regex: `^${args.email}$`, $options: "i" },
    });
    if (!user) {
      console.error(`✗ no user found with email ${args.email}`);
      process.exit(1);
    }
    console.log(
      `  user: ${user.displayName || user.email} · _id=${user._id.toString()} · org=${user.orgId.toString()}`,
    );

    // Same upsert semantics as the API's PUT /api/v1/goals: replace
    // the whole tree. We preserve `_id` + `createdAt` semantics via
    // $set (Mongo upsert keeps the existing _id when one matches).
    const result = await goals.updateOne(
      { orgId: user.orgId, userId: user._id },
      {
        $set: {
          orgId: user.orgId,
          userId: user._id,
          schemaVersion: GOALS_SCHEMA_VERSION,
          l1s: tree.l1s,
          cycleId: null,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      console.log(`  ✓ inserted new goal tree (_id=${result.upsertedId})`);
    } else {
      console.log(`  ✓ updated existing goal tree (matched ${result.matchedCount}, modified ${result.modifiedCount})`);
    }

    // Read back for confirmation.
    const stored = await goals.findOne({
      orgId: user.orgId,
      userId: user._id,
    });
    console.log(
      `\n  verified: ${stored.l1s.length} L1s, ` +
        `${stored.l1s.reduce((s, l) => s + (l.l2s?.length || 0), 0)} L2s persisted.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(`✗ fatal: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
