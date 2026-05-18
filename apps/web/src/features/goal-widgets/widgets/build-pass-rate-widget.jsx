"use client";

import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { NeedsScopeBanner } from "./build-events-shared";

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
  const { data, isLoading, error, windowDays } = useDataSource(spec.source);
  const needsScope = data?.needsScope === true;
  const pct = data?.pct ?? null;
  const pass = data?.pass ?? 0;
  const fail = data?.fail ?? 0;
  const target = spec.source?.target;
  const meets = target && pct != null ? evalTarget(pct, target) : null;

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Build pass · ${windowDays}d`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} unit="%" variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      {needsScope ? (
        <NeedsScopeBanner provider={spec.source?.provider} variant={variant} />
      ) : (
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
              {error
                ? "!"
                : isLoading
                  ? "…"
                  : pct == null
                    ? "—"
                    : `${pct}%`}
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
              pass: <strong>{pass}</strong>
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
              fail: <strong>{fail}</strong>
            </span>
          </div>
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
                background:
                  variant === "light" ? "#ffffff" : "var(--accent)",
              }}
            />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
