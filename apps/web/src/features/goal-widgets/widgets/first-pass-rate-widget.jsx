"use client";

import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";

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
  const { data, isLoading, error, windowDays } = useDataSource(spec.source);
  const pct = data?.pct ?? null;
  const clean = data?.clean ?? 0;
  const pingPong = data?.pingPong ?? 0;
  const target = spec.source?.target;
  const meets = target && pct != null ? evalTarget(pct, target) : null;

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`First-pass rate · ${windowDays}d`}
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
            color:
              variant === "light"
                ? "rgba(255,255,255,0.75)"
                : "var(--muted-fg)",
          }}
        >
          <span>
            clean: <strong>{clean}</strong>
          </span>
          <span
            style={{
              color:
                variant === "light"
                  ? "rgba(255,255,255,0.4)"
                  : "var(--dim-fg)",
            }}
          >
            ·
          </span>
          <span>
            ping-pong: <strong>{pingPong}</strong>
          </span>
        </div>
        {/* Single-segment bar — same chrome as LinkageWidget. */}
        <div
          className="flex h-2 w-full overflow-hidden rounded-full"
          style={{
            background:
              variant === "light"
                ? "rgba(255,255,255,0.18)"
                : "var(--border)",
          }}
        >
          <div
            style={{
              width: `${pct ?? 0}%`,
              background: variant === "light" ? "#ffffff" : "var(--accent)",
            }}
          />
        </div>
        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}
