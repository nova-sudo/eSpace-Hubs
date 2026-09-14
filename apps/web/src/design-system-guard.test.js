import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Design system v2 ("Zinc") guard — see docs/design-system-v2.md §8.
 *
 * Walks src/ and fails on every forbidden pattern from the old "Nothing UI"
 * look: dot-matrix type, the dither/grain textures, the GLYPH face, the
 * italic accent word, dashed hairlines, inline fontFamily overrides, sub-11px
 * type, and raw hex outside the PDF renderer / named chart palettes.
 *
 * This test is repo-wide and is EXPECTED TO FAIL until every feature slice
 * is migrated off the old look — it's a running checklist, not a merge gate,
 * during the migration. Run it scoped to a folder to check that folder's
 * work is clean:
 *
 *   npx tsx --test src/design-system-guard.test.js
 */

const thisFile = fileURLToPath(import.meta.url);
const srcRoot = path.dirname(thisFile);

const SKIP_DIRS = new Set(["node_modules"]);

// Directories exempt from the raw-hex rule (and, since it's a `.js` folder,
// effectively from the whole guard — pdf/ literally cannot read CSS
// variables, and *-palette.js files are named chart-palette constants).
const SKIP_PATH_SUBSTRINGS = ["features/evidence/pdf/", "features\\evidence\\pdf\\"];

const PATTERNS = [
  { name: "font-dot", re: /font-dot/ },
  { name: "--font-dot", re: /--font-dot/ },
  { name: "--dot token", re: /var\(--dot\b/ },
  { name: "Dither*", re: /DitherField|DitherDisc|DitherBars/ },
  { name: "<Grain", re: /<Grain\b/ },
  { name: "GlyphAgent", re: /GlyphAgent/ },
  { name: "italicWord=", re: /italicWord=/ },
  { name: "border-dashed", re: /border-dashed/ },
  { name: "inline fontFamily", re: /fontFamily:/ },
  { name: "sub-11px text", re: /text-\[(9|10|10\.5)px\]/ },
  { name: "raw hex", re: /#[0-9a-fA-F]{6}\b/ },
];

function isSkippedPath(rel) {
  if (rel.endsWith(".test.js") || rel.endsWith(".test.jsx")) return true;
  if (rel.endsWith("-palette.js")) return true;
  if (rel.endsWith("globals.css")) return true;
  return SKIP_PATH_SUBSTRINGS.some((s) => rel.includes(s));
}

function walk(dir) {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return [];
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) return walk(full);
    if (!/\.(js|jsx)$/.test(entry)) return [];
    return [full];
  });
}

test("design-system-v2 guard: no forbidden Nothing-UI patterns", () => {
  const violations = [];

  for (const file of walk(srcRoot)) {
    if (file === thisFile) continue;
    const rel = path.relative(srcRoot, file).split(path.sep).join("/");
    if (isSkippedPath(rel)) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { name, re } of PATTERNS) {
        if (re.test(line)) {
          violations.push(`${rel}:${i + 1}: [${name}] ${line.trim()}`);
        }
      }
    });
  }

  assert.deepEqual(
    violations,
    [],
    `Forbidden design-system-v2 patterns found (see docs/design-system-v2.md §8):\n${violations.join("\n")}`,
  );
});
