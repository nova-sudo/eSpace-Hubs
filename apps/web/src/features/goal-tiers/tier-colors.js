/**
 * The tier → token map — one place that says which tint carries each
 * achievement tier, imported by goal-tier-ui and tier-move (a shared leaf
 * so the two UI files don't import each other).
 *
 * Every tier resolves to a token PAIR (surface + ink), matching a `Badge`
 * tone: not_achieved → peach, achieved → mint, over_achieved → sky,
 * role_model → lav. An unknown/ungraded tier falls back to the neutral
 * (card-alt / muted-fg) pair.
 */

const TIER_TOKENS = {
  not_achieved: { tone: "peach", surface: "var(--peach)", ink: "var(--peach-ink)" },
  achieved: { tone: "mint", surface: "var(--mint)", ink: "var(--mint-ink)" },
  over_achieved: { tone: "sky", surface: "var(--sky)", ink: "var(--sky-ink)" },
  role_model: { tone: "lav", surface: "var(--lav)", ink: "var(--lav-ink)" },
};

const NEUTRAL_TOKENS = { tone: "neutral", surface: "var(--card-alt)", ink: "var(--muted-fg)" };

/** Tier id -> { tone, surface, ink } token pair. Unknown tiers read neutral. */
export const TIER_COLOR = TIER_TOKENS;

/** The ink token to pair with TIER_COLOR[tier] as text on its surface. */
export function tierBadgeFg(tier) {
  return (TIER_TOKENS[tier] || NEUTRAL_TOKENS).ink;
}

/** The `<Badge tone={...}>` name for a tier id. Unknown tiers -> "neutral". */
export function tierTone(tier) {
  return (TIER_TOKENS[tier] || NEUTRAL_TOKENS).tone;
}
