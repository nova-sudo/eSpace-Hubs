"use client";

import { Badge } from "@/components/ui";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";
import { usePublishGoalReading } from "../use-publish-reading";

/**
 * First-pass rate — share of merged PRs that pass review cleanly.
 *
 * Layout mirrors LinkageWidget on purpose: both are percentage-rate
 * widgets driven by the same merged-MR list, just sliced differently
 * (linked vs. clean). Sharing the layout means the user reads them
 * the same way — big % headline, sub-line with clean/ping-pong
 * counts, single progress bar.
 *
 * Headline shows `pct` from `firstPassRatePct(mrs)`. When no merged
 * PRs exist in the window, the data hook returns null and we render
 * an em-dash — beats a misleading "0%".
 *
 * The "ping-pong" terminology is shared with the metric comment.
 * If the team prefers different wording the chip can be renamed in
 * the widget without touching the metric.
 */
export function FirstPassRateWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
}) {
  const { data, isLoading, error, windowLabel, provenance } = useDataSource(spec.source);
  const pct = data?.pct ?? null;
  const clean = data?.clean ?? 0;
  const pingPong = data?.pingPong ?? 0;
  const target = spec.source?.target;
  const meets = target && pct != null ? evalTarget(pct, target) : null;

  // Publish the live reading so the achievement-tier grader can score this goal
  // off the value shown here — instead of "awaiting data" until a snapshot is
  // captured. Null while loading / no data so hasAnyData stays honest.
  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !isLoading && !error && pct != null
      ? {
          value: `${pct}% first-pass · ${clean} clean / ${pingPong} ping-pong`,
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
      label={`First-pass rate · ${windowLabel}`}
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
            clean: <strong className="text-fg">{clean}</strong>
          </span>
          <span className="text-dim-fg">·</span>
          <span>
            ping-pong: <strong className="text-fg">{pingPong}</strong>
          </span>
        </div>
        {/* Single-segment bar — same chrome as LinkageWidget. */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-card-alt">
          <div className="bg-ink" style={{ width: `${pct ?? 0}%` }} />
        </div>
        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}
