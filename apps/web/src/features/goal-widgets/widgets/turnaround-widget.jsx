"use client";

import { Badge, Bars } from "@/components/ui";
import { fmtDays } from "@/lib/fmt";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";
import { usePublishGoalReading } from "../use-publish-reading";
import { useSourceLiveStatus } from "../use-source-live-status";
import { WidgetHeadline } from "../widget-headline";

export function TurnaroundWidget({ spec, goal, variant = "light", className, onRetry }) {
  const ds = useDataSource(spec.source);
  const { data, isLoading, error, windowLabel, provenance } = ds;
  const median = data?.median ?? null;
  const live = useSourceLiveStatus(spec.source, ds, { hasValue: median != null, emptyLabel: "No merges yet" });
  const histogram = data?.histogram || [];
  const target = spec.source?.target;
  const meets = target && median != null ? evalTarget(median, target) : null;

  // Publish the live reading so the tier grader scores off this value.
  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !isLoading && !error && median != null
      ? {
          value: `${fmtDays(median)} median turnaround`,
          score: median,
          unit: "d",
          statusTone: meets === true ? "ok" : meets === false ? "warn" : "accent",
          statusLabel: meets === true ? "on target" : meets === false ? "below target" : "tracked",
          provenance,
        }
      : null,
    { hold: live.pending || Boolean(error) },
  );

  return (
    <WidgetShell
      spec={spec}
      provenance={provenance}
      variant={variant}
      label={`Turnaround · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} unit="d" variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <WidgetHeadline
          status={live}
          skeleton="w-[3.5ch]"
          after={
            <>
              <span className="text-[13px] text-muted-fg">median</span>
              {meets != null ? (
                <Badge tone={meets ? "mint" : "peach"} className="ml-auto">
                  {meets ? "On target" : "Over target"}
                </Badge>
              ) : null}
            </>
          }
        >
          {median != null ? fmtDays(median) : null}
        </WidgetHeadline>
        <Bars data={histogram.map((b) => ({ n: b.n, label: b.label }))} height={56} />
        <div className="flex gap-[3px]">
          {histogram.map((b) => (
            <span key={b.label} className="flex-1 text-center text-[11px] text-muted-fg">
              {b.label}
            </span>
          ))}
        </div>
        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}
