"use client";

import { fmtDays } from "@/lib/fmt";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";

/**
 * Ticket-cycle-time widget — Jira-side counterpart to TURNAROUND.
 *
 * Cycle time here is `resolutiondate − created` (the simple MVP — see
 * `metrics/ticket-cycle.js` for the why-no-changelog-yet note). Layout
 * mirrors TurnaroundWidget so the two read as a matched pair when a goal
 * tree contains both PR-throughput and ticket-throughput sub-goals.
 *
 * Headline: median cycle time in days
 * Sub:      bin histogram (`<1d`, `1–3d`, `3–7d`, `1–2w`, `2–4w`, `>4w`)
 * Footer:   ComplianceLine (manual progress overlay)
 *
 * Empty / loading / error states piggyback on the same numeric/glyph
 * pattern the other auto widgets use ("…" / "!"), so the analyst grid
 * stays visually consistent.
 */
export function TicketCycleWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
}) {
  const { data, isLoading, error, windowDays } = useDataSource(spec.source);
  const median = data?.median ?? null;
  const histogram = data?.histogram || [];
  const resolvedCount = data?.resolvedCount ?? 0;
  const target = spec.source?.target;
  const meets = target && median != null ? evalTarget(median, target) : null;
  const maxBin = Math.max(...histogram.map((b) => b.n), 1);

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Ticket cycle · ${windowDays}d`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} unit="d" variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <div
            className="font-semibold leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 48,
              letterSpacing: "-1.6px",
            }}
          >
            {error ? "!" : isLoading ? "…" : fmtDays(median)}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color:
                variant === "light"
                  ? "rgba(255,255,255,0.72)"
                  : "var(--muted-fg)",
            }}
          >
            median
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
              {meets ? "on target" : "over target"}
            </div>
          ) : null}
        </div>

        {/* Histogram — same visual idiom as TURNAROUND, wider day bins. */}
        <div className="flex items-end gap-[3px]" style={{ height: 42 }}>
          {histogram.map((b) => {
            const h = Math.max(2, (b.n / maxBin) * 40);
            return (
              <div
                key={b.label}
                className="flex flex-1 flex-col items-center gap-1"
                title={`${b.label}: ${b.n}`}
              >
                <div
                  className="w-full rounded-t-[2px]"
                  style={{
                    height: h,
                    background:
                      variant === "light"
                        ? "rgba(255,255,255,0.6)"
                        : "var(--accent-dim)",
                  }}
                />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 8.5,
                    color:
                      variant === "light"
                        ? "rgba(255,255,255,0.6)"
                        : "var(--dim-fg)",
                  }}
                >
                  {b.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Sample-size hint when low signal so the median isn't taken at
            face value (a single fast-resolved ticket would otherwise read
            as "<1d cycle time" with no caveat). */}
        {!error && !isLoading && resolvedCount > 0 && resolvedCount < 5 ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color:
                variant === "light"
                  ? "rgba(255,255,255,0.6)"
                  : "var(--muted-fg)",
            }}
          >
            low signal · {resolvedCount} resolved in window
          </div>
        ) : null}
        {!error && !isLoading && resolvedCount === 0 ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color:
                variant === "light"
                  ? "rgba(255,255,255,0.65)"
                  : "var(--muted-fg)",
            }}
          >
            no resolved tickets in the last {windowDays} days
          </div>
        ) : null}

        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}
