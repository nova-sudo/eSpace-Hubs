/**
 * Public API for the grading feature.
 *
 * Consumers:
 *   - `CodeRubricWidget` (dashboard) — uses `useGradedPrs`.
 *   - `CodeRubricEditor` / `CodeRubricGridRow` (check-in) — same hook.
 *   - SCORECARD component widgets that embed a CODE_RUBRIC — same hook
 *     with `scopeKey` so per-component verdicts don't collide.
 *
 * Storage:
 *   - The verdict cache is now API-direct (`verdicts-store.js`). The
 *     in-memory Map hydrates from `GET /api/v1/grading-verdicts` on
 *     first mount after sign-in, and POSTs writes to the API
 *     optimistically. There is no longer a localStorage mirror or a
 *     `<GradingSync />` lifecycle component — the hook handles
 *     hydration itself, gated on the active session.
 */
export { useGradedPrs, resolveRubric } from "./use-graded-prs";
export { rubricHash, normalizeRubric } from "./rubric-hash";
export {
  readVerdict,
  saveVerdict,
  clearVerdicts,
  pruneUnrelated,
  fetchVerdicts,
  resetVerdicts,
  subscribeVerdicts,
  getVerdictsState,
  GRADING_CHANGE_EVENT,
} from "./verdicts-store";
