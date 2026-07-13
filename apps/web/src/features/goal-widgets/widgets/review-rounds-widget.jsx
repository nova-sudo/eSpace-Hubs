"use client";

import { fmtNumber } from "@/lib/fmt";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";
import { usePublishGoalReading } from "../use-publish-reading";

/**
 * Review-rounds widget — average reviewer comments per merged MR.
 *
 * "Team" comparison was removed because we don't actually have a team-wide
 * API to derive a real p50 from — the prior version used a hardcoded
 * constant which is misleading in a performance dashboard. If we ever add
 * a real team aggregator, restore the second bar by re-deriving from that
 * source (NOT a constant).
 */
export function ReviewRoundsWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { data, isLoading, error, windowLabel } = useDataSource(spec.source);
  const value = data?.value ?? null;
  const target = spec.source?.target;
  const meets = target && value != null ? evalTarget(value, target) : null;

  // Publish the live reading so the tier grader scores off this value.
  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !isLoading && !error && value != null
      ? {
          value: `${fmtNumber(value)} avg reviewer comments per MR`,
          score: value,
          unit: "",
          statusTone: meets === true ? "ok" : meets === false ? "warn" : "accent",
          statusLabel: meets === true ? "on target" : meets === false ? "below target" : "tracked",
        }
      : null,
  );

  // Bar fill is a relative gauge: 0 → max(value, target). When a target is
  // present, it acts as the visual ceiling so users see exactly where they
  // sit relative to the rule. Without a target, we fall back to the value
  // itself so a fresh widget still shows a full bar.
  const ceiling = Math.max(value || 0, target?.value || 0, 1);
  const fillYou = value != null ? Math.min(100, (value / ceiling) * 100) : 0;
  const targetFill =
    target?.value != null ? Math.min(100, (target.value / ceiling) * 100) : null;

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Review rounds · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <div
            className="font-semibold leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 48,
              letterSpacing: "-1.6px",
            }}
          >
            {error ? "!" : isLoading ? "…" : fmtNumber(value ?? 0, 1)}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
            }}
          >
            avg · lower is tighter
          </div>
          {meets != null ? (
            <div
              className="ml-auto uppercase tracking-[0.5px]"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: meets ? "var(--accent-2)" : "rgba(255,255,255,0.7)",
              }}
            >
              {meets ? "on target" : "drifting"}
            </div>
          ) : null}
        </div>

        {/* Single bar: your average. If a target exists, draw a vertical
            tick-mark on the bar to show where the rule sits — no second
            bar comparing against fake team data. */}
        <BarWithTarget
          value={value != null ? fmtNumber(value, 1) : "—"}
          fill={fillYou}
          targetFill={targetFill}
          variant={variant}
        />
        {/* Cadence compliance — % of historical weeks at target,
            computed from the snapshot stream. The headline number
            above is "right now"; this line is "over time". */}
        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}

function BarWithTarget({ value, fill, targetFill, variant }) {
  const track = variant === "light" ? "rgba(255,255,255,0.2)" : "var(--border)";
  const fillColor = variant === "light" ? "#ffffff" : "var(--accent)";
  const tickColor =
    variant === "light" ? "rgba(255,255,255,0.55)" : "var(--accent-2)";
  const muted = variant === "light" ? "rgba(255,255,255,0.7)" : "var(--muted-fg)";

  return (
    <div className="flex items-center gap-2">
      <span
        className="w-8 shrink-0"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: muted }}
      >
        You
      </span>
      <div
        className="relative h-1.5 flex-1 overflow-hidden rounded-full"
        style={{ background: track }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${fill}%`, background: fillColor }}
        />
        {targetFill != null ? (
          <div
            aria-hidden="true"
            title="target"
            className="absolute inset-y-[-2px] w-[2px] rounded-full"
            style={{ left: `${targetFill}%`, background: tickColor }}
          />
        ) : null}
      </div>
      <span
        className="w-8 shrink-0 text-right font-semibold"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
      >
        {value}
      </span>
    </div>
  );
}
