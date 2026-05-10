"use client";

import { LineSpark } from "@/components/ui";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";

/**
 * AUTO widget — "merged count in window" with 8-week trend + optional target.
 * Reads from spec.source (provider, window, target).
 */
export function MergedCountWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { data, isLoading, error, windowDays } = useDataSource(spec.source);
  const count = data?.count ?? null;
  const trend = data?.trend || [];
  const target = spec.source?.target;
  const hit = target && count != null ? evalTarget(count, target) : null;

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Merged · last ${windowDays}d`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <div
            className="font-semibold leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 56,
              letterSpacing: "-1.8px",
            }}
          >
            {error ? "!" : isLoading ? "…" : count ?? 0}
          </div>
          {hit != null ? (
            <div
              className="uppercase tracking-[0.5px]"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: hit ? "var(--accent-2)" : "rgba(255,255,255,0.7)",
              }}
            >
              {hit ? "on target" : "below target"}
            </div>
          ) : null}
        </div>
        {trend.length >= 2 ? (
          <LineSpark
            data={trend}
            color={variant === "light" ? "#ffffff" : "var(--accent)"}
            height={40}
            strokeWidth={2}
            fillOpacity={variant === "light" ? 0.22 : 0.2}
            showDots
          />
        ) : (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: variant === "light" ? "rgba(255,255,255,0.6)" : "var(--dim-fg)",
            }}
          >
            Trend builds after 2+ weeks of merges.
          </div>
        )}
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
