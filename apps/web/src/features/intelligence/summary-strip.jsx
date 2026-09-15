"use client";

/**
 * The page's one-row summary: weighted cadence completion as a big numeral,
 * a paced bar with the "expected by now" tick, and the status counts.
 *
 * Deliberately NOT a chart. A distribution donut over a dozen goals says
 * nothing you can't read faster from four badges, and a chart at the top of
 * an attention-first page competes with the thing that actually needs the
 * user. One row, then out of the way.
 *
 * Presentation only — every number arrives pre-computed from progress.js.
 */

import { Badge, Card, Label, PacedBar, yearElapsedPercent } from "@/components/ui";

export function SummaryStrip({ percent, counts, className }) {
  const expected = Math.round(yearElapsedPercent());
  const value = percent == null ? 0 : percent;

  const badges = [
    { key: "onPace", tone: "mint", label: `${counts.onPace} on pace`, n: counts.onPace },
    { key: "behind", tone: "peach", label: `${counts.behind} behind`, n: counts.behind },
    { key: "notLogged", tone: "lemon", label: `${counts.notLogged} not logged`, n: counts.notLogged },
    {
      key: "unclassified",
      tone: "neutral",
      label: `${counts.unclassified} unclassified`,
      n: counts.unclassified,
    },
  ].filter((b) => b.n > 0);

  return (
    <Card padding={20} className={className}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <div className="shrink-0">
          <Label>Weighted progress</Label>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg">
              {percent == null ? "—" : `${percent}%`}
            </span>
            <span className="text-[12.5px] text-muted-fg">expected {expected}%</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <PacedBar value={value} height={8} />
          <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-dim-fg">
            <span>Jan</span>
            <span>Dec</span>
          </div>
        </div>

        {badges.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 sm:shrink-0">
            {badges.map((b) => (
              <Badge key={b.key} tone={b.tone}>
                {b.label}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
