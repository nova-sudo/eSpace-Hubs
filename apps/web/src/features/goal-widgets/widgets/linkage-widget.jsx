"use client";

import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";
import { usePublishGoalReading } from "../use-publish-reading";

export function LinkageWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { data, isLoading, error, windowLabel } = useDataSource(spec.source);
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
      variant={variant}
      label={`Jira linkage · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} unit="%" variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <div
            className="font-semibold leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 52,
              letterSpacing: "-1.8px",
            }}
          >
            {isLoading ? "…" : pct == null ? "—" : `${pct}%`}
          </div>
          {error ? (
            <div
              className="ml-auto uppercase tracking-[0.5px]"
              title={error?.message || String(error)}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "rgba(255,255,255,0.72)",
              }}
            >
              source unavailable
            </div>
          ) : meets != null ? (
            <div
              className="ml-auto uppercase tracking-[0.5px]"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: meets ? "var(--accent-2)" : "rgba(255,255,255,0.7)",
              }}
            >
              {meets ? "on target" : "below target"}
            </div>
          ) : null}
        </div>
        <div
          className="flex items-center gap-3"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: variant === "light" ? "rgba(255,255,255,0.75)" : "var(--muted-fg)",
          }}
        >
          <span>
            linked: <strong>{linked}</strong>
          </span>
          <span
            style={{
              color:
                variant === "light" ? "rgba(255,255,255,0.4)" : "var(--dim-fg)",
            }}
          >
            ·
          </span>
          <span>
            orphans: <strong>{loose}</strong>
          </span>
        </div>
        {/* Simple linked/orphan track */}
        <div
          className="flex h-2 w-full overflow-hidden rounded-full"
          style={{
            background:
              variant === "light" ? "rgba(255,255,255,0.18)" : "var(--border)",
          }}
        >
          <div
            style={{
              width: `${pct ?? 0}%`,
              background:
                variant === "light" ? "#ffffff" : "var(--accent)",
            }}
          />
        </div>
        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}
