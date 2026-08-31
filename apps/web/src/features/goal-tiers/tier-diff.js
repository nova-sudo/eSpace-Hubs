/**
 * Tier-ordering math — the ONE place that owns before/after rung
 * comparisons (F9 G0.2). `capVerdictByConsistency`, the carousel rank,
 * and the fill-feedback diff all need TIER_ORDER positions; per BR-5
 * nobody else re-derives them by hand.
 *
 * This file is also the canonical home of TIER_ORDER / TIER_LABELS —
 * use-goal-tier re-exports them (its historical export site) so every
 * existing consumer keeps working, while pure modules (this one, the
 * transitions store, tests) can import the ladder WITHOUT pulling the
 * "use client" hook file and closing an ES-module cycle.
 *
 * Pure — no React, no IO.
 */

export const TIER_ORDER = [
  "not_achieved",
  "achieved",
  "over_achieved",
  "role_model",
];

export const TIER_LABELS = {
  not_achieved: "Not achieved",
  achieved: "Achieved",
  over_achieved: "Over achieved",
  role_model: "Role model",
};

/**
 * Diff two tiers into a structured move, or null when there is no real
 * move to report:
 *   - `to` missing/unknown        → nothing landed
 *   - `from === undefined`        → never observed / mid-hydration (G2.3:
 *                                   distinct from null — must NOT read as
 *                                   a landing)
 *   - `from === null`             → first grade (BR-11) — a landing, not
 *                                   a move; the diff stays null and the
 *                                   celebration layer handles landings
 *                                   separately if at all
 *   - `from === to`               → no change (BR-4)
 *   - unknown tier id either side → null, never a throw (mirrors
 *                                   capVerdictByConsistency's idx guard)
 *
 * Otherwise `{ from, to, direction: "up"|"down", steps, label }` where
 * `label` is display-ready ("Achieved → Over achieved").
 */
export function tierDelta(from, to) {
  if (from === undefined) return null;
  if (from == null) return null;
  if (to == null) return null;
  if (from === to) return null;
  const fromIdx = TIER_ORDER.indexOf(from);
  const toIdx = TIER_ORDER.indexOf(to);
  // BR-11's trap: indexOf(null/unknown) = -1 must never read as "worse
  // than not_achieved".
  if (fromIdx < 0 || toIdx < 0) return null;
  return {
    from,
    to,
    direction: toIdx > fromIdx ? "up" : "down",
    steps: Math.abs(toIdx - fromIdx),
    label: `${TIER_LABELS[from]} → ${TIER_LABELS[to]}`,
  };
}
