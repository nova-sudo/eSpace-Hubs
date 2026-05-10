/**
 * Stable event contract between any ClassifierPort implementation and the
 * UI. The port emits these; the analyst page reads them. The UI NEVER
 * reaches into the adapter's native message shapes.
 *
 * Swapping Mistral for Anthropic, OpenAI, or a local model is a matter of
 * writing a new adapter that emits `AnalysisEvent`s. Nothing else changes.
 */

export const ANALYSIS = Object.freeze({
  /** Fired once when classification begins. payload: { totalGoals, startedAt } */
  START: "analysis:start",

  /** Fired per goal when the adapter picks it up. payload: { goalId, title, parentL1? } */
  GOAL_STARTED: "analysis:goal-started",

  /** Streaming reasoning chunks. payload: { goalId, chunk } */
  GOAL_REASONING: "analysis:goal-reasoning",

  /** Successful classification. payload: { goalId, spec } */
  GOAL_CLASSIFIED: "analysis:goal-classified",

  /** Per-goal failure; the pipeline continues. payload: { goalId, error } */
  GOAL_FAILED: "analysis:goal-failed",

  /** Fired once when every goal has been processed. payload: { count, elapsedMs } */
  COMPLETE: "analysis:complete",
});

export const ALL_ANALYSIS_EVENTS = Object.freeze(Object.values(ANALYSIS));

/**
 * Small helpers so producers don't hand-assemble the event shape. Keeping
 * these as named factories means a typo in an event type would fail at
 * import time rather than silently emit an unrecognized event.
 */
export const AnalysisEvents = Object.freeze({
  start(payload) {
    return { type: ANALYSIS.START, payload };
  },
  goalStarted(payload) {
    return { type: ANALYSIS.GOAL_STARTED, payload };
  },
  goalReasoning(payload) {
    return { type: ANALYSIS.GOAL_REASONING, payload };
  },
  goalClassified(payload) {
    return { type: ANALYSIS.GOAL_CLASSIFIED, payload };
  },
  goalFailed(payload) {
    return { type: ANALYSIS.GOAL_FAILED, payload };
  },
  complete(payload) {
    return { type: ANALYSIS.COMPLETE, payload };
  },
});
