// Public surface of the goal-tiers feature (AI achievement-tier grading).
export {
  useGoalTier,
  useGoalWindowTier,
  readCappedGoalTier,
  TIER_ORDER,
  TIER_LABELS,
  TIER_FIELD,
} from "./use-goal-tier";
export {
  readGoalTier,
  resetGoalTiers,
  hydrateGoalTiers,
  subscribeGoalTiers,
  getGoalTiersSnapshot,
  getGoalTiersServerSnapshot,
} from "./goal-tier-store";
export {
  readManagerVerdict,
  hydrateManagerVerdicts,
  resetManagerVerdicts,
  subscribeManagerVerdicts,
  getManagerVerdictsSnapshot,
  getManagerVerdictsServerSnapshot,
} from "./manager-verdict-store";
export {
  readTierPolicy,
  hydrateTierPolicies,
  resetTierPolicies,
  subscribeTierPolicies,
  getTierPoliciesSnapshot,
  getTierPoliciesServerSnapshot,
} from "./tier-policy-store";
export {
  publishGoalLiveReading,
  readGoalLiveReading,
  resetGoalLiveReadings,
  subscribeGoalLiveReadings,
  getGoalLiveReadingsSnapshot,
  getGoalLiveReadingsServerSnapshot,
} from "./live-readings-store";
export { GoalTierBadge, GoalTierLadder } from "./goal-tier-ui";
export { numericReadingFor, gradeNumericTier } from "./grade-numeric";
// F9 — instant tier feedback.
export { tierDelta } from "./tier-diff";
export { TIER_COLOR, tierBadgeFg } from "./tier-colors";
export {
  recordTierTransition,
  readTierTransition,
  clearTierTransition,
  subscribeTierTransitions,
  getTierTransitionsSnapshot,
  getTierTransitionsServerSnapshot,
  resetTierTransitions,
} from "./tier-transitions-store";
export { useTierFillFeedback } from "./use-tier-fill-feedback";
export { TierDeltaBadge } from "./tier-move";
