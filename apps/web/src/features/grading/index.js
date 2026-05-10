/**
 * Public API for the grading feature.
 *
 * Consumers:
 *   - `CodeRubricWidget` (the only consumer today) uses `useGradedPrs`.
 *   - Future: a per-PR drawer could use `readVerdict` directly.
 *   - The root layout mounts <GradingSync /> to pull from the API
 *     once the user signs in (M7.2 mirror mode).
 */
export { useGradedPrs, resolveRubric } from "./use-graded-prs";
export { rubricHash, normalizeRubric } from "./rubric-hash";
export {
  readVerdict,
  saveVerdict,
  clearVerdicts,
  pruneUnrelated,
  GRADING_CHANGE_EVENT,
} from "./grading-store";
export { GradingSync } from "./grading-sync-mount";
