import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const featuresRoot = path.dirname(thisFile);

// Intentional migration debt — callers that can't safely go through the
// public barrel without a larger refactor. Each entry must have a comment
// explaining WHY it isn't promoted and WHO owns the cleanup.
//
// Items formerly here that are now promoted:
//   analyst/reclassify-one-goal  → analyst/index.js
//   analyst/use-ai-provider      → analyst/index.js
//   dashboard/date-range         → dashboard/index.js
//   prefs/prefs-store            → prefs/index.js
const allowedDeepImports = new Set([
  // auth/session-store: the session store is security-sensitive and must not
  // be re-exported from the auth barrel — it exposes raw token reads that
  // should never be casually imported. Only prefs-store and api-client use it.
  "auth/session-store",

  // goal-widgets/widgets/scorecard-subspec: a deep sub-widget imported by
  // the scorecard widget itself. Promoting it risks exposing an unstable
  // internal API; track in the goal-widgets refactor milestone.
  "goal-widgets/widgets/scorecard-subspec",

  // integrations/api-clients/proxy-fetch: transport primitive imported
  // directly by the three provider API clients inside the same feature.
  // Already internal to integrations — the barrel re-exports the clients,
  // not the fetch primitive, by design.
  "integrations/api-clients/proxy-fetch",
]);

function walk(dir) {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) return walk(full);
    if (!/\.(js|jsx)$/.test(entry)) return [];
    if (entry.endsWith(".test.js") || entry.endsWith(".test.jsx")) return [];
    return [full];
  });
}

function owningFeature(file) {
  const rel = path.relative(featuresRoot, file);
  return rel.split(path.sep)[0];
}

test("feature slices do not add unreviewed deep imports into other features", () => {
  const violations = [];
  const importRe =
    /import\s+(?:[\s\S]*?\s+from\s+)?["']@\/features\/([^"']+)["']/g;

  for (const file of walk(featuresRoot)) {
    const sourceFeature = owningFeature(file);
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(importRe)) {
      const target = match[1];
      const targetFeature = target.split("/")[0];
      const isDeep = target.includes("/");
      if (!isDeep || sourceFeature === targetFeature) continue;
      if (allowedDeepImports.has(target)) continue;
      violations.push(
        `${path.relative(featuresRoot, file)} imports @/features/${target}`,
      );
    }
  }

  assert.deepEqual(
    violations,
    [],
    "Cross-feature imports should go through the target feature barrel. Add an allowlist entry only for intentional migration debt.",
  );
});
