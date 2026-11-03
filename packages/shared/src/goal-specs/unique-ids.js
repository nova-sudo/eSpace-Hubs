/**
 * Goal ids must be unique across a tree — every surface keys objectives
 * and goals by id (tile filters, collapse state, spec / reading lookups),
 * so two L1s sharing one id silently collapse into one on the Goals page.
 *
 * Imports have produced duplicates (the Zoho L1 export stamps the
 * employee's link id on every KRA row), so the API runs this on the way
 * in AND on the way out: a tree already stored with duplicates renders
 * correctly at once, and the next save persists the repaired ids.
 *
 * Deterministic: the first occurrence keeps its id, later ones get
 * `<id>~2`, `<id>~3`, … skipping any suffix already in use. Running it
 * on its own output is a no-op, so the ids a client reads are the ids it
 * writes back. Returns the SAME array when nothing needed renaming.
 */

const SEP = "~";

function nextFree(id, taken) {
  let n = 2;
  while (taken.has(`${id}${SEP}${n}`)) n += 1;
  return `${id}${SEP}${n}`;
}

/**
 * @template {{ id: string, l2s?: Array<{ id: string }> }} L1
 * @param {L1[]} l1s
 * @returns {L1[]} the input when already unique, else a renamed copy
 */
export function uniqueGoalIds(l1s) {
  if (!Array.isArray(l1s)) return l1s;
  const taken = new Set();
  let changed = false;

  const claim = (id) => {
    if (typeof id !== "string" || id === "") return id;
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
    changed = true;
    const fresh = nextFree(id, taken);
    taken.add(fresh);
    return fresh;
  };

  // Claim every L1 id first, then every L2 — the suffix for a duplicate
  // depends only on what precedes it in tree order, never on later rows.
  const out = l1s.map((l1) => ({ ...l1, id: claim(l1?.id) }));
  for (let i = 0; i < out.length; i += 1) {
    const l2s = out[i].l2s;
    if (!Array.isArray(l2s)) continue;
    out[i] = { ...out[i], l2s: l2s.map((l2) => ({ ...l2, id: claim(l2?.id) })) };
  }
  return changed ? out : l1s;
}
