/**
 * Approval ladders — the pure draft model behind the editable
 * "Achievement levels" block on the manager + admin approval pages.
 *
 * Two ladders per tracker: `tiers` (the whole cycle) and `cadenceTiers`
 * (each window). Each draft holds four string rows ("" for null) and a
 * `touched` flag. Only touched ladders go into the approve payload, so an
 * approver who changes nothing never overwrites (or locks) the AI's ladder.
 */

export const TIER_ROWS = [
  ["notAchieved", "Not achieved", "peach"],
  ["achieved", "Achieved", "mint"],
  ["overAchieved", "Over-achieved", "sky"],
  ["roleModel", "Role model", "lav"],
];

export const LADDERS = ["tiers", "cadenceTiers"];

function draftOf(ladder) {
  const rows = {};
  for (const [field] of TIER_ROWS) rows[field] = ladder?.[field] ?? "";
  return { rows, touched: false };
}

export function initLadders(item) {
  return {
    tiers: draftOf(item?.tiers),
    cadenceTiers: draftOf(item?.cadenceTiers),
    source: item?.tiersSource === "user" ? "user" : "ai",
  };
}

export function editRow(state, ladder, field, value) {
  return {
    ...state,
    [ladder]: { rows: { ...state[ladder].rows, [field]: value }, touched: true },
  };
}

export function resetLadder(state, ladder, item) {
  return { ...state, [ladder]: draftOf(item?.[ladder]) };
}

export function ladderPayload(state) {
  const out = {};
  for (const ladder of LADDERS) {
    const draft = state[ladder];
    if (!draft?.touched) continue;
    const rows = {};
    for (const [field] of TIER_ROWS) {
      const v = String(draft.rows[field] ?? "").trim();
      rows[field] = v ? v : null;
    }
    out[ladder] = rows;
  }
  return out;
}

/** "weekly" → "week". The noun used in the per-window ladder's heading. */
export function cadenceNoun(cadence) {
  return { weekly: "week", monthly: "month", quarterly: "quarter" }[cadence] ?? "window";
}
