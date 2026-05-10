/**
 * Stable hash for a rubric — an array of short criterion strings.
 *
 * Used as a cache-key fragment so:
 *   - the same rubric → same hash → cache HIT (free re-render)
 *   - the user edits the rubric → different hash → forced re-grade
 *
 * Not a cryptographic hash; we just need determinism and collision avoidance
 * in the practical case (a handful of short strings per user). Simple
 * "djb2"-style rolling hash is enough and has no bundle cost.
 */

export function rubricHash(rubric) {
  const normalized = normalizeRubric(rubric);
  return djb2(normalized.join("\u0001")).toString(16);
}

export function normalizeRubric(rubric) {
  if (!rubric) return [];
  const items = Array.isArray(rubric)
    ? rubric
    : typeof rubric === "string"
      ? rubric.split(/\r?\n/)
      : [];
  return items
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  // Coerce to unsigned 32-bit so the hex output is stable across platforms.
  return h >>> 0;
}
