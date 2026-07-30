/**
 * Which field list a STORED COMPOSED entry's `values` should be read
 * against. Pure — no React — so it can be unit-tested directly instead of
 * only through whatever pulls in `use-goal-tier.js`'s full (React + store)
 * module graph.
 *
 * A nested-cadence COMPOSED spec stores a nested level's entry under a
 * compound periodKey ("2026-Q1::2026-W3" — see composed-widget.jsx's header
 * comment), and that entry's `values` are keyed by the NESTED level's field
 * ids, not the top-level `spec.fields` ids. Grading used to always read
 * every period's values against `spec.fields` regardless — which for a
 * nested entry meant every field label came back blank (`vals[f.id]` looking
 * up ids that don't exist on that record) and the entry's real content was
 * invisible to the AI grader.
 *
 * Walks the compound key backward through the same nesting `composed-widget`
 * renders forward through: split on "::", resolve segment 0 against the top
 * level (mirrors `resolvePeriodContent`, just keyed by a STORED string
 * instead of `Date.now()`), then each further segment against whatever that
 * period nested, inheriting the containing window's bounds as the fallback
 * exactly like rendering does. Falls back to `spec.fields` — always SAFE,
 * just possibly wrong-for-that-entry — the moment a segment can't be located
 * (a spec that changed shape since the entry was written), rather than
 * guessing.
 */

import { buildCycleWindows, composedCycleBounds } from "@/features/goal-inputs";
import { resolvePeriodContent, resolveNestedPeriodContent } from "@/features/goal-specs";

export function fieldsForPeriodKey(spec, periodKey) {
  const baseFields = Array.isArray(spec?.fields) ? spec.fields : [];
  if (!periodKey || periodKey === "__single__" || !periodKey.includes("::")) {
    return baseFields;
  }
  const segments = periodKey.split("::");
  const topCadence = spec?.composed?.cadence;
  if (!topCadence) return baseFields;
  const topBounds = composedCycleBounds(spec);
  const topCyc = buildCycleWindows({
    entries: [],
    cadence: topCadence,
    now: Date.now(),
    ...topBounds,
  });
  const topIdx = (topCyc.windows || []).findIndex((w) => w.key === segments[0]);
  if (topIdx < 0) return baseFields;

  let period = resolvePeriodContent(spec, topIdx);
  let fields = period.fields.length > 0 ? period.fields : baseFields;
  let composedBlock = period.nested;
  let fallbackStart = topCyc.windows[topIdx]?.start ?? null;
  let fallbackEnd = topCyc.windows[topIdx]?.end ?? null;

  for (let i = 1; i < segments.length; i += 1) {
    if (!composedBlock?.cadence) break;
    const explicit = composedCycleBounds({ composed: composedBlock });
    const cycleStart = explicit.cycleStart ?? fallbackStart ?? undefined;
    const cycleEnd = explicit.cycleEnd ?? fallbackEnd ?? undefined;
    const hasBounds = cycleStart != null && cycleEnd != null;
    const cyc = buildCycleWindows({
      entries: [],
      cadence: composedBlock.cadence,
      now: Date.now(),
      ...(hasBounds ? { cycleStart, cycleEnd } : {}),
    });
    const idx = (cyc.windows || []).findIndex((w) => w.key === segments[i]);
    if (idx < 0) break;
    const inner = resolveNestedPeriodContent(composedBlock, idx);
    fields = inner.fields.length > 0 ? inner.fields : fields;
    fallbackStart = cyc.windows[idx]?.start ?? null;
    fallbackEnd = cyc.windows[idx]?.end ?? null;
    composedBlock = inner.nested;
  }
  return fields;
}
