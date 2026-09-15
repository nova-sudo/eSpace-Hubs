/**
 * Goal Intelligence Hub — public API.
 *
 * The Dev hub's home surface and its supporting pieces. Product surfaces
 * import `IntelligencePage`; the rest is exported for reuse/testing and as
 * the AI-narrative integration seam (StatusNarrative / ruleBasedNarrative).
 */

export { IntelligencePage } from "./intelligence-page";
export { StatusNarrative, ruleBasedNarrative } from "./status-narrative";
export { SummaryStrip } from "./summary-strip";
export { FocusSection } from "./focus-section";
export { FocusHero } from "./focus-hero";
export { ObjectiveBands } from "./objective-bands";
export { ActionQueue } from "./action-queue";
export { useGoalHealth } from "./use-goal-health";
export {
  cadenceCells,
  goalProgressPercent,
  objectiveProgressPercent,
  statusCounts,
  weightedProgressPercent,
  worstChildStatus,
} from "./progress";
export {
  deriveGoalHealth,
  HEALTH,
  NEEDS_ATTENTION,
  STATUS_META,
  statusDisplay,
} from "./status";
