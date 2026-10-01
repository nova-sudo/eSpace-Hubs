"use client";

/**
 * The page's one-row summary: "Logged so far" (of the check-ins that were
 * due, how many are logged — the same number the Goals page leads with), a
 * bar, the line naming what ISN'T in the number, and the status counts.
 *
 * Deliberately NOT a chart. A distribution donut over a dozen goals says
 * nothing you can't read faster from four badges, and a chart at the top of
 * an attention-first page competes with the thing that actually needs the
 * user. One row, then out of the way.
 *
 * Presentation only — every number arrives pre-computed from progress.js.
 */

import { ProgressSummary } from "@/components/ui";
import { unmeasuredLine } from "@/features/goal-inputs";

const HELP =
  "Of the check-ins that were due so far, how many you logged (or marked as nothing to report), with each objective counting by its weight. Weeks before a tracker existed and weeks still to come are never counted. On pace means everything due is logged.";

/**
 * @param {object} props
 * @param {number|null} props.percent   "logged so far", weighted (progress.js)
 * @param {{done:number, due:number}} props.logged  check-ins across measured goals
 * @param {Array} props.counts          countStatuses() badges, worst first
 * @param {number} props.unmeasured     goals not in `percent`
 */
export function SummaryStrip({ percent, logged, counts, unmeasured = 0, className }) {
  // Same component as the Goals page (components/ui ProgressSummary), so the
  // two pages can never lay the same number out differently again.
  return (
    <ProgressSummary
      percent={percent}
      logged={logged}
      counts={counts}
      note={unmeasuredLine(unmeasured) ?? "Every goal with a tracker is in this number."}
      help={HELP}
      className={className}
    />
  );
}
