/**
 * Per-PR grading verdict cache.
 *
 * Goal: never re-grade an unchanged PR against an unchanged rubric.
 *
 * Shape in localStorage:
 *   {
 *     [cacheKey]: {
 *       prId:      number,
 *       rubricHash:string,
 *       verdict:   { pass, reasoning, violations },
 *       gradedAt:  number
 *     }
 *   }
 *
 * cacheKey = `${prId}::${rubricHash}`
 *
 * Kept in its own store (not goal-context, not goal-inputs) because:
 *   - it has a different key cardinality (per PR, not per goal)
 *   - its invalidation rule is "rubric changed", not "user wrote something"
 *   - it's effectively an external-service response cache, conceptually
 *     closer to SWR than to user-owned state
 */

const STORAGE_KEY = "espace-devhub:grading";
const CHANGE_EVENT = "grading:change";

export const GRADING_CHANGE_EVENT = CHANGE_EVENT;

function readAll() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeAll(next) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function makeCacheKey(prId, rubricHash) {
  return `${prId}::${rubricHash}`;
}

/** Read a cached verdict, or null if not present. */
export function readVerdict(prId, rubricHash) {
  const all = readAll();
  const entry = all[makeCacheKey(prId, rubricHash)];
  return entry?.verdict || null;
}

/** Persist a verdict. Overwrites any prior entry for the same (prId, rubric). */
export function saveVerdict(prId, rubricHash, verdict) {
  if (!prId || !rubricHash || !verdict) return;
  const all = readAll();
  all[makeCacheKey(prId, rubricHash)] = {
    prId,
    rubricHash,
    verdict,
    gradedAt: Date.now(),
  };
  writeAll(all);
}

/**
 * Garbage collect: keep only entries that match the supplied current-rubric
 * hash for their PRs. Called by the widget when it detects a rubric change
 * so the cache doesn't grow unbounded over a long-lived session.
 */
export function pruneUnrelated(currentRubricHashByPr) {
  const all = readAll();
  const next = {};
  for (const [key, entry] of Object.entries(all)) {
    const expected = currentRubricHashByPr[entry.prId];
    if (expected && entry.rubricHash === expected) {
      next[key] = entry;
    }
  }
  writeAll(next);
}

/** Wipe everything — reserved for a future "reset grading cache" user action. */
export function clearVerdicts() {
  writeAll({});
}
