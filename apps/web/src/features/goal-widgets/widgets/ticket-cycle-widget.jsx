"use client";

import { Badge, Bars, Label } from "@/components/ui";
import { fmtDays } from "@/lib/fmt";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";
import { usePublishGoalReading } from "../use-publish-reading";

/**
 * Ticket-cycle-time widget — Jira-side counterpart to TURNAROUND.
 *
 * Cycle time here is `resolutiondate − created` (the simple MVP — see
 * `metrics/ticket-cycle.js` for the why-no-changelog-yet note). Layout
 * mirrors TurnaroundWidget so the two read as a matched pair when a goal
 * tree contains both PR-throughput and ticket-throughput sub-goals.
 *
 * Headline: median cycle time in days
 * Sub:      bin histogram (`<1d`, `1–3d`, `3–7d`, `1–2w`, `2–4w`, `>4w`)
 * Footer:   ComplianceLine (manual progress overlay)
 *
 * Empty / loading / error states piggyback on the same numeric/glyph
 * pattern the other auto widgets use ("…" / "!"), so the analyst grid
 * stays visually consistent.
 */
export function TicketCycleWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
}) {
  const { data, isLoading, error, windowLabel, provenance } = useDataSource(spec.source);
  const median = data?.median ?? null;
  const histogram = data?.histogram || [];
  const resolvedCount = data?.resolvedCount ?? 0;
  const target = spec.source?.target;
  const meets = target && median != null ? evalTarget(median, target) : null;

  // Publish the live reading so the tier grader scores off this value.
  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !isLoading && !error && median != null
      ? {
          value: `${fmtDays(median)} median cycle · ${resolvedCount} resolved`,
          score: median,
          unit: "d",
          statusTone: meets === true ? "ok" : meets === false ? "warn" : "accent",
          statusLabel: meets === true ? "on target" : meets === false ? "below target" : "tracked",
          provenance,
        }
      : null,
  );

  return (
    <WidgetShell
      spec={spec}
      provenance={provenance}
      variant={variant}
      label={`Ticket cycle · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} unit="d" variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
            {error ? "!" : isLoading ? "…" : fmtDays(median)}
          </div>
          <span className="text-[13px] text-muted-fg">median</span>
          {meets != null ? (
            <Badge tone={meets ? "mint" : "peach"} className="ml-auto">
              {meets ? "On target" : "Over target"}
            </Badge>
          ) : null}
        </div>

        {/* Histogram — same visual idiom as TURNAROUND, wider day bins. */}
        <Bars data={histogram.map((b) => ({ n: b.n, label: b.label }))} height={56} />
        <div className="flex gap-[3px]">
          {histogram.map((b) => (
            <span key={b.label} className="flex-1 text-center text-[11px] text-dim-fg">
              {b.label}
            </span>
          ))}
        </div>

        {/* Sample-size hint when low signal so the median isn't taken at
            face value (a single fast-resolved ticket would otherwise read
            as "<1d cycle time" with no caveat). */}
        {!error && !isLoading && resolvedCount > 0 && resolvedCount < 5 ? (
          <Label>low signal · {resolvedCount} resolved in window</Label>
        ) : null}
        {!error && !isLoading && resolvedCount === 0 ? (
          <Label>no resolved tickets {windowLabel}</Label>
        ) : null}

        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}
