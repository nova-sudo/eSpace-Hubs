"use client";

import { Badge } from "@/components/ui";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { NeedsScopeBanner } from "./build-events-shared";
import { usePublishGoalReading } from "../use-publish-reading";

/**
 * AUTO widget — % of completed CI builds in window that succeeded.
 *
 * Denominator excludes still-running and "unknown"-conclusion builds
 * (e.g. GitHub Actions runs that were skipped because of a path
 * filter). Including them would distort the rate downward for clean
 * pipelines with conditional jobs.
 *
 * Headline is "pct%" with a sub-line showing pass / fail counts.
 * Layout intentionally mirrors LinkageWidget + FirstPassRateWidget
 * so all three "percentage rate" widgets read the same.
 *
 * Returns "—" for the headline when no completed builds exist (pct
 * is null from the metric layer) — avoids a misleading "0%" on
 * empty windows.
 */
export function BuildPassRateWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
}) {
  const { data, isLoading, error, windowLabel, provenance } = useDataSource(spec.source);
  const needsScope = data?.needsScope === true;
  const pct = data?.pct ?? null;
  const pass = data?.pass ?? 0;
  const fail = data?.fail ?? 0;
  const target = spec.source?.target;
  const meets = target && pct != null ? evalTarget(pct, target) : null;

  // Publish for the Evidence board (same "N%" it shows here).
  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !needsScope && !isLoading && !error && pct != null
      ? {
          value: `${pct}%`,
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
      label={`Build pass · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} unit="%" variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      {needsScope ? (
        <NeedsScopeBanner provider={spec.source?.provider} />
      ) : (
        <div className="flex h-full flex-col justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
              {error ? "!" : isLoading ? "…" : pct == null ? "—" : `${pct}%`}
            </div>
            {meets != null ? (
              <Badge tone={meets ? "mint" : "peach"} className="ml-auto">
                {meets ? "On target" : "Below target"}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-3 text-[12.5px] text-muted-fg">
            <span>
              pass: <strong className="text-fg">{pass}</strong>
            </span>
            <span className="text-dim-fg">·</span>
            <span>
              fail: <strong className="text-fg">{fail}</strong>
            </span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-card-alt">
            <div className="bg-ink" style={{ width: `${pct ?? 0}%` }} />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
