"use client";

import { Badge } from "@/components/ui";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";
import { usePublishGoalReading } from "../use-publish-reading";
import { useSourceLiveStatus } from "../use-source-live-status";
import { WidgetHeadline } from "../widget-headline";

export function LinkageWidget({ spec, goal, variant = "light", className, onRetry }) {
  const ds = useDataSource(spec.source);
  const { data, isLoading, error, windowLabel, provenance } = ds;
  const pct = data?.pct ?? null;
  const live = useSourceLiveStatus(spec.source, ds, { hasValue: pct != null, emptyLabel: "No merges yet" });
  const linked = data?.linked ?? 0;
  const loose = data?.loose ?? 0;
  const target = spec.source?.target;
  const meets = target && pct != null ? evalTarget(pct, target) : null;

  // Publish the live reading so the tier grader scores off this value.
  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !isLoading && !error && pct != null
      ? {
          value: `${pct}% linked · ${linked} linked / ${loose} loose`,
          score: pct,
          unit: "%",
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
      label={`Jira linkage · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} unit="%" variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <WidgetHeadline
          status={live}
          skeleton="w-[3ch]"
          after={
            meets != null ? (
              <Badge tone={meets ? "mint" : "peach"} className="ml-auto">
                {meets ? "On target" : "Below target"}
              </Badge>
            ) : null
          }
        >
          {pct != null ? `${pct}%` : null}
        </WidgetHeadline>
        <div className="flex items-center gap-3 text-[12.5px] text-muted-fg">
          <span>
            linked: <strong className="text-fg">{linked}</strong>
          </span>
          <span className="text-dim-fg">·</span>
          <span>
            orphans: <strong className="text-fg">{loose}</strong>
          </span>
        </div>
        {/* Simple linked/orphan track */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-track">
          <div className="bg-ink" style={{ width: `${pct ?? 0}%` }} />
        </div>
        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}
