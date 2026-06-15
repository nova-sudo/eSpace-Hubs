"use client";

/**
 * Widget-kind → inline editor dispatch, shared by the weekly check-in and
 * the Goal Intelligence Hub's inline "Fill now".
 *
 * Scope: MANUAL-family widgets only — the kinds that take a hand-entered
 * value scoped to a cadence window. AUTO widgets need no filling, and the
 * two composite kinds (CODE_RUBRIC, SCORECARD) have richer editors that
 * live with the check-in page; callers should route those to /checkin
 * instead of rendering them inline. `isInlineFillable()` tells a caller
 * which path to take.
 *
 * Every editor writes straight to the goal-inputs store on input (scoped
 * to `activeLabel`'s mid-week timestamp), so the dispatch holds no state.
 */

import { SPEC_KINDS } from "@/features/goal-specs";
import {
  BeforeAfterEditor,
  CounterEditor,
  DateLogEditor,
  FreeTextEditor,
  IncidentLogEditor,
  MilestoneEditor,
  RecurringMilestoneEditor,
  ScaleEditor,
} from "./editors";

/** Manual kinds with a self-contained inline editor in this module. */
export const INLINE_FILLABLE_KINDS = Object.freeze(
  new Set([
    SPEC_KINDS.COUNTER,
    SPEC_KINDS.SCALE,
    SPEC_KINDS.MILESTONE,
    SPEC_KINDS.FREE_TEXT,
    SPEC_KINDS.DATE_LOG,
    SPEC_KINDS.BEFORE_AFTER,
    SPEC_KINDS.INCIDENT_LOG,
    SPEC_KINDS.RECURRING_MILESTONE,
  ]),
);

export function isInlineFillable(widget) {
  return INLINE_FILLABLE_KINDS.has(widget);
}

/**
 * Render the right editor for `widget`. Returns null for kinds that aren't
 * inline-fillable, so callers can fall back to a link.
 */
export function GoalManualEditor({
  widget,
  goal,
  spec,
  weekStart,
  weekEnd,
  activeLabel,
}) {
  switch (widget) {
    case SPEC_KINDS.COUNTER:
      return (
        <CounterEditor
          goal={goal}
          spec={spec}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.SCALE:
      return (
        <ScaleEditor
          goal={goal}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.MILESTONE:
      return (
        <MilestoneEditor
          goal={goal}
          spec={spec}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.FREE_TEXT:
      return (
        <FreeTextEditor
          goal={goal}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.DATE_LOG:
      return (
        <DateLogEditor
          goal={goal}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.BEFORE_AFTER:
      return (
        <BeforeAfterEditor
          goal={goal}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.INCIDENT_LOG:
      return (
        <IncidentLogEditor
          goal={goal}
          spec={spec}
          weekStart={weekStart}
          weekEnd={weekEnd}
          activeLabel={activeLabel}
        />
      );
    case SPEC_KINDS.RECURRING_MILESTONE:
      return (
        <RecurringMilestoneEditor goal={goal} spec={spec} activeLabel={activeLabel} />
      );
    default:
      return null;
  }
}
