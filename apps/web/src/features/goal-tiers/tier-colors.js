/**
 * The four tier colors + their badge foregrounds — one map, imported by
 * goal-tier-ui and tier-move (a shared leaf so the two UI files don't
 * import each other).
 *
 * Foreground note (F9 G2.4): white text on `over_achieved` (#00c48a)
 * and `role_model` (#f59e0b) measures 2.27:1 / 2.15:1 — an outright
 * WCAG AA failure on exactly the rungs the product celebrates reaching.
 * A dark foreground on those two measures ~8.7:1 / ~9.2:1; the two
 * darker fills keep white (6.5:1 / 6.7:1).
 */

export const TIER_COLOR = {
  not_achieved: "#b91c1c", // bad
  achieved: "#1D4ED8", // accent
  over_achieved: "#00c48a", // accent-2
  role_model: "#f59e0b", // amber — exemplary
};

/** Foreground to pair with TIER_COLOR[tier] as a solid fill. */
export function tierBadgeFg(tier) {
  return tier === "over_achieved" || tier === "role_model"
    ? "#0a0a0a"
    : "#ffffff";
}
