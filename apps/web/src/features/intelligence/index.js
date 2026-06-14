/**
 * Goal Intelligence Hub — public API.
 *
 * The Dev hub's home surface and its supporting pieces. Product surfaces
 * import `IntelligencePage`; the rest is exported for reuse/testing and as
 * the Sprint-2 AI-narrative integration seam (StatusNarrative /
 * ruleBasedNarrative).
 */

export { IntelligencePage } from "./intelligence-page";
export { StatusNarrative, ruleBasedNarrative } from "./status-narrative";
export { GoalHealthGrid } from "./goal-health-grid";
export { GoalHealthCard } from "./goal-health-card";
export { ActionQueue } from "./action-queue";
export { useGoalHealth } from "./use-goal-health";
export { deriveGoalHealth, HEALTH, NEEDS_ATTENTION, STATUS_META } from "./status";
