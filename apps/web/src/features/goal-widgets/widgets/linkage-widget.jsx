"use client";

import { Badge } from "@/components/ui";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";
import { usePublishGoalReading } from "../use-publish-reading";

export function LinkageWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { data, isLoading, error, windowLabel, provenance } = useDataSource(spec.source);
  const pct = data?.pct ?? null;
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
        }
      : null,
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
        <div className="flex items-baseline gap-2">
          <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
            {isLoading ? "…" : pct == null ? "—" : `${pct}%`}
          </div>
          {error ? (
            <Badge tone="neutral" className="ml-auto" title={error?.message || String(error)}>
              Source unavailable
            </Badge>
          ) : meets != null ? (
            <Badge tone={meets ? "mint" : "peach"} className="ml-auto">
              {meets ? "On target" : "Below target"}
            </Badge>
          ) : null}
        </div>
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
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-card-alt">
          <div className="bg-ink" style={{ width: `${pct ?? 0}%` }} />
        </div>
        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}
