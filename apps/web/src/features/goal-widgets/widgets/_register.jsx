"use client";

/**
 * Side-effect module: binds every built-in widget to its SPEC_KIND in the
 * registry. Imported exactly once from `goal-widgets/index.js` so the
 * registrations happen at module load — no manual wiring at the component
 * level, no switch statements to maintain.
 *
 * Adding a 12th widget:
 *   1. Write `widgets/some-widget.jsx`.
 *   2. Add a `SPEC_KINDS.SOME` entry to `goal-specs/types.js`.
 *   3. Append one registerWidget(...) line here.
 *   That's it — the analyst, the grid, and the error boundary pick it up
 *   automatically.
 */

import { SPEC_KINDS, SPEC_VARIANTS } from "@/features/goal-specs";
import { registerWidget } from "../registry";

import { MergedCountWidget } from "./merged-count-widget";
import { ReviewRoundsWidget } from "./review-rounds-widget";
import { TurnaroundWidget } from "./turnaround-widget";
import { LinkageWidget } from "./linkage-widget";
import { TicketCycleWidget } from "./ticket-cycle-widget";
import { FirstPassRateWidget } from "./first-pass-rate-widget";
import { CodeRubricWidget } from "./code-rubric-widget";

import { CounterWidget } from "./counter-widget";
import { ScaleWidget } from "./scale-widget";
import { MilestoneWidget } from "./milestone-widget";
import { DateLogWidget } from "./date-log-widget";
import { FreeTextWidget } from "./free-text-widget";
import { BeforeAfterWidget } from "./before-after-widget";
import { IncidentLogWidget } from "./incident-log-widget";
import { RecurringMilestoneWidget } from "./recurring-milestone-widget";

// AUTO widgets — read from integration sources via useDataSource.
registerWidget(SPEC_KINDS.MERGED_COUNT, {
  variant: SPEC_VARIANTS.AUTO,
  Component: MergedCountWidget,
  description: "Count of merged PRs/MRs in a window, with 8-week trend.",
});
registerWidget(SPEC_KINDS.REVIEW_ROUNDS, {
  variant: SPEC_VARIANTS.AUTO,
  Component: ReviewRoundsWidget,
  description: "Average reviewer comments per merged MR (you vs team p50).",
});
registerWidget(SPEC_KINDS.TURNAROUND, {
  variant: SPEC_VARIANTS.AUTO,
  Component: TurnaroundWidget,
  description: "Median open→merged duration + histogram.",
});
registerWidget(SPEC_KINDS.LINKAGE, {
  variant: SPEC_VARIANTS.AUTO,
  Component: LinkageWidget,
  description: "Percent of MRs referencing a Jira key.",
});
registerWidget(SPEC_KINDS.TICKET_CYCLE, {
  variant: SPEC_VARIANTS.AUTO,
  Component: TicketCycleWidget,
  description:
    "Median Jira ticket cycle (created → resolved) with day-bin histogram.",
});
registerWidget(SPEC_KINDS.FIRST_PASS_RATE, {
  variant: SPEC_VARIANTS.AUTO,
  Component: FirstPassRateWidget,
  description:
    "% of merged PRs that pass first review cleanly (≤1 reviewer comment).",
});
registerWidget(SPEC_KINDS.CODE_RUBRIC, {
  variant: SPEC_VARIANTS.AUTO,
  Component: CodeRubricWidget,
  description:
    "AI-graded pull requests scored against the user's rubric (captured via spec.context).",
});

// MANUAL widgets — read/write via useGoalInputs.
registerWidget(SPEC_KINDS.COUNTER, {
  variant: SPEC_VARIANTS.MANUAL,
  Component: CounterWidget,
  description: "Running total with +1/-1/+5 buttons and weekly tallies.",
});
registerWidget(SPEC_KINDS.SCALE, {
  variant: SPEC_VARIANTS.MANUAL,
  Component: ScaleWidget,
  description: "1–5 rating with history sparkline.",
});
registerWidget(SPEC_KINDS.MILESTONE, {
  variant: SPEC_VARIANTS.MANUAL,
  Component: MilestoneWidget,
  description: "Checklist with add/remove + progress bar.",
});
registerWidget(SPEC_KINDS.DATE_LOG, {
  variant: SPEC_VARIANTS.MANUAL,
  Component: DateLogWidget,
  description: "Dated event log with optional note per entry.",
});
registerWidget(SPEC_KINDS.FREE_TEXT, {
  variant: SPEC_VARIANTS.MANUAL,
  Component: FreeTextWidget,
  description: "Dated journal entries.",
});
registerWidget(SPEC_KINDS.BEFORE_AFTER, {
  variant: SPEC_VARIANTS.MANUAL,
  Component: BeforeAfterWidget,
  description: "Baseline vs. current numeric with delta.",
});
registerWidget(SPEC_KINDS.INCIDENT_LOG, {
  variant: SPEC_VARIANTS.MANUAL,
  Component: IncidentLogWidget,
  description:
    "Per-incident log (severity + downtime + post-mortem). Rolls up MTTR and SLA-budget consumption.",
});
registerWidget(SPEC_KINDS.RECURRING_MILESTONE, {
  variant: SPEC_VARIANTS.MANUAL,
  Component: RecurringMilestoneWidget,
  description:
    "Milestone checklist that resets each cadence period. Tracks streak of complete periods.",
});
