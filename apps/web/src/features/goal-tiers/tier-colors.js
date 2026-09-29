/**
 * The tier → token map — one place that says which tint carries each
 * achievement tier, imported by goal-tier-ui and tier-move (a shared leaf
 * so the two UI files don't import each other).
 *
 * Every tier resolves to its tint's tokens, matching a `Badge` tone:
 * not_achieved → peach, achieved → mint, over_achieved → sky,
 * role_model → lav. An unknown/ungraded tier falls back to neutral.
 *
 *   surface  the tint fill
 *   ink      text/marks ON that tint surface (identical in both themes)
 *   text     text/dots/marks on a PLAIN surface (card, card-alt, canvas) —
 *            the theme-aware `--*-text` token; `-ink` on a dark card fails
 *            contrast.
 */

const TIER_TOKENS = {
  not_achieved: { tone: "peach", surface: "var(--peach)", ink: "var(--peach-ink)", text: "var(--peach-text)" },
  achieved: { tone: "mint", surface: "var(--mint)", ink: "var(--mint-ink)", text: "var(--mint-text)" },
  over_achieved: { tone: "sky", surface: "var(--sky)", ink: "var(--sky-ink)", text: "var(--sky-text)" },
  role_model: { tone: "lav", surface: "var(--lav)", ink: "var(--lav-ink)", text: "var(--lav-text)" },
};

const NEUTRAL_TOKENS = {
  tone: "neutral",
  surface: "var(--card-alt)",
  ink: "var(--muted-fg)",
  text: "var(--muted-fg)",
};

/** Tier id -> { tone, surface, ink } token pair. Unknown tiers read neutral. */
export const TIER_COLOR = TIER_TOKENS;

/** The ink token to pair with TIER_COLOR[tier] as text on its surface. */
export function tierBadgeFg(tier) {
  return (TIER_TOKENS[tier] || NEUTRAL_TOKENS).ink;
}

/** The colour for a tier's text / dot / mark on a PLAIN surface (theme-aware). */
export function tierTextColor(tier) {
  return (TIER_TOKENS[tier] || NEUTRAL_TOKENS).text;
}

/** The `<Badge tone={...}>` name for a tier id. Unknown tiers -> "neutral". */
export function tierTone(tier) {
  return (TIER_TOKENS[tier] || NEUTRAL_TOKENS).tone;
}
