"use client";

import { LineSpark, Badge } from "@/components/ui";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { usePublishGoalReading } from "../use-publish-reading";
import { useSourceLiveStatus } from "../use-source-live-status";
import { WidgetHeadline } from "../widget-headline";

/**
 * AUTO widget — "merged count in window" with 8-week trend + optional target.
 * Reads from spec.source (provider, window, target).
 */
export function MergedCountWidget({ spec, goal, variant = "light", className, onRetry }) {
  const ds = useDataSource(spec.source);
  const { data, isLoading, error, windowLabel, provenance } = ds;
  const count = data?.count ?? null;
  // A resolved zero reads as "No merges yet", not a bare 0 — the same word
  // Home uses. (The grader still gets the 0 below.)
  const live = useSourceLiveStatus(spec.source, ds, {
    hasValue: count != null && count > 0,
    emptyLabel: "No merges yet this year",
  });
  const trend = data?.trend || [];
  const target = spec.source?.target;
  const hit = target && count != null ? evalTarget(count, target) : null;

  // Publish the live reading so the tier grader scores off this value (not
  // "awaiting data" until a snapshot exists). Null while loading / no data.
  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !isLoading && !error && count != null
      ? {
          value: `${count} merged`,
          score: count,
          unit: "",
          statusTone: hit === true ? "ok" : hit === false ? "warn" : "accent",
          statusLabel: hit === true ? "on target" : hit === false ? "below target" : "tracked",
          provenance,
        }
      : null,
    // A failed / rate-limited refresh keeps the last published reading —
    // Home and Evidence fall back to it instead of going blank.
    { hold: live.pending || Boolean(error) },
  );

  return (
    <WidgetShell
      spec={spec}
      provenance={provenance}
      variant={variant}
      label={`Merged · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <WidgetHeadline
          status={live}
          after={hit != null ? <Badge tone={hit ? "mint" : "peach"}>{hit ? "On target" : "Below target"}</Badge> : null}
        >
          {count}
        </WidgetHeadline>
        {trend.length >= 2 && count ? (
          <LineSpark data={trend} color="var(--ink)" height={40} strokeWidth={2} fillOpacity={0.16} showDots />
        ) : count ? (
          <div className="text-[12.5px] text-muted-fg">Trend builds after 2+ weeks of merges.</div>
        ) : null}
      </div>
    </WidgetShell>
  );
}

function evalTarget(value, target) {
  if (!target || typeof value !== "number") return null;
  if (target.op === ">=") return value >= target.value;
  if (target.op === "<=") return value <= target.value;
  if (target.op === "=") return value === target.value;
  return null;
}

export { evalTarget };
export const MergedCountWidget_displayName = "MergedCountWidget";
MergedCountWidget.displayName = MergedCountWidget_displayName;
