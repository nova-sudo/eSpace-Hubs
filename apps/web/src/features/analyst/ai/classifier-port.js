/**
 * ClassifierPort — the interface any AI classifier must satisfy.
 *
 * Documented in JSDoc (no runtime enforcement). Typescript would make this
 * a compile-time interface; since this project is JS-only, the contract is
 * the doc + the test that `classify()` returns an AsyncIterable of
 * AnalysisEvents.
 *
 *   interface ClassifierPort {
 *     classify(
 *       goals: Array<GoalForClassification>,
 *       options?: { signal?: AbortSignal; concurrency?: number }
 *     ): AsyncIterable<AnalysisEvent>
 *   }
 *
 *   GoalForClassification = {
 *     id: string,
 *     title: string,
 *     description?: string,     // rubric, notes, etc
 *     parentL1Title?: string,   // when the goal is an L2, the parent L1 title
 *     kind: "L1" | "L2",
 *   }
 *
 *   AnalysisEvent → see analysis-events.js
 *
 * Contract details:
 *   - MUST yield exactly one START event as the first item
 *   - MUST yield exactly one COMPLETE event as the last item
 *   - For each goal, MUST yield either a GOAL_CLASSIFIED or a GOAL_FAILED
 *     (never both)
 *   - GOAL_REASONING is optional; consumers render them as typing-indicator
 *     token chunks
 *   - If `signal.aborted`, the iterable must stop producing and finish
 *     with a COMPLETE event carrying the partial count
 */

/**
 * Marker function so callers can assert an object "looks like" a port. Cheap
 * structural check — not a type guard, just a dev-time convenience.
 */
export function isClassifierPort(candidate) {
  return (
    candidate &&
    typeof candidate.classify === "function"
  );
}
