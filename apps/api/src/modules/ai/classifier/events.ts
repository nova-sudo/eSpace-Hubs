/**
 * Stable event contract between any classifier implementation and the
 * UI. The classifier emits these; the analyst page reads them. The UI
 * NEVER reaches into the adapter's native message shapes.
 *
 * Swapping Mistral for Anthropic, OpenAI, or a local model is a matter
 * of writing a new adapter that emits `AnalysisEvent`s. Nothing
 * downstream changes.
 *
 * Ported from apps/web/src/features/analyst/ai/analysis-events.js
 * (M3.2). The shape is identical so the existing UI code consumes the
 * stream from the new API endpoint without modification.
 */

import type { ValidatedSpec } from "./spec-types.js";

export const ANALYSIS = {
  /** Fired once when classification begins. */
  START: "analysis:start",
  /** Fired per goal when the adapter picks it up. */
  GOAL_STARTED: "analysis:goal-started",
  /** Streaming reasoning chunks. */
  GOAL_REASONING: "analysis:goal-reasoning",
  /** Successful classification. */
  GOAL_CLASSIFIED: "analysis:goal-classified",
  /** Per-goal failure; the pipeline continues. */
  GOAL_FAILED: "analysis:goal-failed",
  /** Fired once when every goal has been processed. */
  COMPLETE: "analysis:complete",
  /** Catch-all error envelope when the stream itself fails. */
  ERROR: "analysis:error",
} as const;

export const ALL_ANALYSIS_EVENTS = Object.values(ANALYSIS);

interface StartPayload {
  totalGoals: number;
  startedAt: number;
}
interface GoalStartedPayload {
  goalId: string;
  title: string;
  parentL1?: string | undefined;
}
interface GoalReasoningPayload {
  goalId: string;
  chunk: string;
}
interface GoalClassifiedPayload {
  goalId: string;
  spec: ValidatedSpec;
}
interface GoalFailedPayload {
  goalId: string;
  error: string;
}
interface CompletePayload {
  count: number;
  elapsedMs: number;
}
interface ErrorPayload {
  error: string;
}

export type AnalysisEvent =
  | { type: typeof ANALYSIS.START; payload: StartPayload }
  | { type: typeof ANALYSIS.GOAL_STARTED; payload: GoalStartedPayload }
  | { type: typeof ANALYSIS.GOAL_REASONING; payload: GoalReasoningPayload }
  | { type: typeof ANALYSIS.GOAL_CLASSIFIED; payload: GoalClassifiedPayload }
  | { type: typeof ANALYSIS.GOAL_FAILED; payload: GoalFailedPayload }
  | { type: typeof ANALYSIS.COMPLETE; payload: CompletePayload }
  | { type: typeof ANALYSIS.ERROR; payload: ErrorPayload };

export const AnalysisEvents = {
  start(payload: StartPayload): AnalysisEvent {
    return { type: ANALYSIS.START, payload };
  },
  goalStarted(payload: GoalStartedPayload): AnalysisEvent {
    return { type: ANALYSIS.GOAL_STARTED, payload };
  },
  goalReasoning(payload: GoalReasoningPayload): AnalysisEvent {
    return { type: ANALYSIS.GOAL_REASONING, payload };
  },
  goalClassified(payload: GoalClassifiedPayload): AnalysisEvent {
    return { type: ANALYSIS.GOAL_CLASSIFIED, payload };
  },
  goalFailed(payload: GoalFailedPayload): AnalysisEvent {
    return { type: ANALYSIS.GOAL_FAILED, payload };
  },
  complete(payload: CompletePayload): AnalysisEvent {
    return { type: ANALYSIS.COMPLETE, payload };
  },
  error(payload: ErrorPayload): AnalysisEvent {
    return { type: ANALYSIS.ERROR, payload };
  },
};
