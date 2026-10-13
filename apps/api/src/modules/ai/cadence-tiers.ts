type SpecTiers = Record<string, string>;

/** Widgets whose checklist resets each period, so one window needs its own ladder. */
const PERIOD_RESET_WIDGETS = new Set(["RECURRING_MILESTONE", "COMPOSED"]);

export function resetsPerPeriod(widget: unknown): boolean {
  return typeof widget === "string" && PERIOD_RESET_WIDGETS.has(widget);
}

/**
 * Fallback per-window ladder for a period-reset widget whose model omitted
 * `cadenceTiers`: the whole-plan/streak `tiers` can't grade one window, so
 * grade a single period on its own. Other widgets (or no tiers) -> null.
 */
export function deriveCadenceTiers(
  widget: string,
  tiers: SpecTiers | null,
): SpecTiers | null {
  if (!tiers || !resetsPerPeriod(widget)) return null;
  return {
    notAchieved: "This period's checklist incomplete",
    achieved: "This period's checklist fully complete",
    overAchieved: "Complete with evidence or notes beyond the ask this period",
    roleModel: "Complete, linked and ahead of schedule this period",
  };
}
