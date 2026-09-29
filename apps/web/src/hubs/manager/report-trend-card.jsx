"use client";

/**
 * One report's weekly snapshot trend, for the board's rail: merged PRs
 * per week as a sparkline, plus how many goals met their window in the
 * latest week. Data: GET /manager/reports/:userId/snapshots.
 */

import { Card, Label, Sparkline } from "@/components/ui";
import { useReportTrend } from "./use-team-trends";
import { latestWeekLine, mergedSeries } from "./trend-format";

export function ReportTrendCard({ userId }) {
  const { loading, error, series } = useReportTrend(userId, 12);
  if (loading) return null;
  const merged = mergedSeries(series);
  const line = latestWeekLine(series);

  return (
    <Card padding={18}>
      <Label>Weekly trend</Label>
      {error ? (
        <p className="mt-2 text-[12.5px] text-muted-fg">Couldn&apos;t load their snapshots.</p>
      ) : series.length === 0 ? (
        <p className="mt-2 text-[12.5px] leading-[1.5] text-muted-fg">
          No weekly snapshots yet. They&apos;re captured when they open their
          dashboard, and frozen weekly by the scheduler.
        </p>
      ) : (
        <>
          {merged.length >= 2 ? (
            <Sparkline data={merged} height={44} fillOpacity={0.08} className="mt-3" />
          ) : null}
          <div className="mt-2 text-[12.5px] leading-[1.5] text-fg">Latest: {line}</div>
          <div className="mt-0.5 text-[11.5px] text-muted-fg">
            {merged.length >= 2
              ? `Line: merged PRs per week, last ${series.length} week${series.length === 1 ? "" : "s"}`
              : `${series.length} weekly snapshot${series.length === 1 ? "" : "s"} · no PR data to chart`}
          </div>
        </>
      )}
    </Card>
  );
}
