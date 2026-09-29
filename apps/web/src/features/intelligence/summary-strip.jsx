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

import { Badge, Card, Label, PacedBar } from "@/components/ui";
import { unmeasuredLine } from "@/features/goal-inputs";

/**
 * @param {object} props
 * @param {number|null} props.percent   "logged so far", weighted (progress.js)
 * @param {{done:number, due:number}} props.logged  check-ins across measured goals
 * @param {Array} props.counts          countStatuses() badges, worst first
 * @param {number} props.unmeasured     goals not in `percent`
 */
export function SummaryStrip({ percent, logged, counts, unmeasured = 0, className }) {
  const value = percent == null ? 0 : percent;
  // `counts` is the canonical ordered array from goal-inputs, worst first —
  // the same list the Goals page renders, so the two pages can never tally
  // the same goals differently again.
  const badges = counts || [];
  const due = logged?.due ?? 0;
  const done = logged?.done ?? 0;
  const excluded = unmeasuredLine(unmeasured);

  return (
    <Card padding={20} className={className}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <div
          className="shrink-0"
          title="Of the check-ins that were due so far, how many you logged (or marked as nothing to report), with each objective counting by its weight. Weeks before a tracker existed and weeks still to come are never counted. On pace means everything due is logged."
        >
          <Label>Logged so far</Label>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg">
              {percent == null ? "—" : `${percent}%`}
            </span>
            <span className="text-[12.5px] text-muted-fg">
              {due > 0 ? `of what was due · ${done} of ${due} check-ins` : "nothing due yet"}
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <PacedBar value={value} expected={100} height={8} />
          <div className="mt-1.5 text-[12px] text-muted-fg">
            {excluded ?? "Every goal with a tracker is in this number."}
          </div>
        </div>

        {badges.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 sm:shrink-0">
            {badges.map((b) => (
              <span key={b.status} title={b.description}>
                <Badge tone={b.tone}>
                  {b.count} {b.label.toLowerCase()}
                </Badge>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
