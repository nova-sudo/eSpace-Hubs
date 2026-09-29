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

/**
 * B2 (a11y review): `--dim-fg` clears 3:1 but NOT the 4.5:1 body-text bar,
 * so as a TEXT colour it is allowed only where the text is not information:
 *   - a `placeholder:` / `disabled:` variant (prefixed, so never matched here)
 *   - a decorative separator (`·`, `—` as "no value")
 *   - an aria-hidden / icon glyph, or a dimmed ("before", opacity-) cell
 * Anything else is body copy and must be `text-muted-fg`. What the heuristic
 * can't see is listed in DIM_ALLOW with a reason and a per-file count, so a
 * new bare `text-dim-fg` fails here instead of in a reader's eyes.
 */
const DIM_TEXT = /(^|[^:\w-])text-dim-fg\b/;
const DIM_OK_LINE = /aria-hidden|>\s*[·—]\s*<|"—"|<[A-Z][A-Za-z]+ size=|opacity-|ring-track/;
const DIM_ALLOW = {
  "features/goals-flow/timeline-view.jsx": 1, // disclosure chevron icon (non-text, ≥ 3:1)
  "features/goals-flow/focus-view.jsx": 1, // disclosure chevron icon
  "hubs/admin/admin-users.jsx": 1, // search glyph inside the field
  "hubs/qa/defects-tile.jsx": 1, // 56px empty-state numeral — large text, ≥ 3:1
  "hubs/qa/flake-rate-tile.jsx": 1, // 56px empty-state numeral
  "hubs/qa/build-pass-rate-tile.jsx": 3, // 56px empty-state numerals
  "hubs/qa/defect-priority-mix-tile.jsx": 1, // 56px empty-state numeral
};

test("design-system-v2 guard: text-dim-fg only for placeholders, disabled and decoration", () => {
  const violations = [];
  for (const file of walk(srcRoot)) {
    if (file === thisFile) continue;
    const rel = path.relative(srcRoot, file).split(path.sep).join("/");
    if (isSkippedPath(rel)) continue;
    let bare = 0;
    const hits = [];
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!DIM_TEXT.test(line) || DIM_OK_LINE.test(line)) return;
        bare += 1;
        hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    if (bare > (DIM_ALLOW[rel] || 0)) violations.push(...hits);
  }
  assert.deepEqual(
    violations,
    [],
    `text-dim-fg used for readable text (use text-muted-fg — docs/design-system-v2.md §2):\n${violations.join("\n")}`,
  );
});

/**
 * B1 (a11y review): a tint's `-ink` colour is only legible ON that tint —
 * in dark it drops to 1.5–2.5:1 on a plain card. On a plain surface use the
 * theme-aware `-text` token (`text-peach-text`, `bg-peach-text` for a dot).
 * Heuristic: a `{text,bg,fill,stroke,ring,border}-<tint>-ink` must have its
 * tint surface (`bg-<tint>` or `tone="<tint>"`) on the same line or within
 * the 16 lines above it (the enclosing element).
 */
const TINT_INK = /(?<![\w-])(?:[a-z-]+:)*(?:text|bg|fill|stroke|ring|border)-(mint|sky|lav|peach|lemon)-ink\b/g;
const INK_ALLOW = {
  "components/ui/insight-row.jsx": 1, // lav-ink only when tone === "lav" (bg-lav)
};

test("design-system-v2 guard: tint -ink colours only on their own tint surface", () => {
  const violations = [];
  for (const file of walk(srcRoot)) {
    if (file === thisFile) continue;
    const rel = path.relative(srcRoot, file).split(path.sep).join("/");
    if (isSkippedPath(rel)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    const hits = [];
    lines.forEach((line, i) => {
      for (const m of line.matchAll(TINT_INK)) {
        const tint = m[1];
        const surface = new RegExp(`bg-${tint}(?![\\w-])|tone=\\{?["']${tint}["']`);
        const ctx = lines.slice(Math.max(0, i - 16), i + 1).join("\n");
        if (!surface.test(ctx)) hits.push(`${rel}:${i + 1}: ${m[0]} :: ${line.trim()}`);
      }
    });
    if (hits.length > (INK_ALLOW[rel] || 0)) violations.push(...hits);
  }
  assert.deepEqual(
    violations,
    [],
    `tint -ink colour off its tint surface (use the -text token — docs/design-system-v2.md §2):\n${violations.join("\n")}`,
  );
});
