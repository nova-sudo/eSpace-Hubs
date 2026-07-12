"use client";

import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { NeedsScopeBanner } from "./build-events-shared";
import { usePublishGoalReading } from "../use-publish-reading";

/**
 * AUTO widget — median build duration in MINUTES for successful
 * builds in the window. Tracks delivery lead-time as a CI proxy:
 *
 *   - Median is the headline (50th percentile is more honest than
 *     mean when one runaway build skews everything).
 *   - 6-bucket histogram across [<1m, 1-5, 5-15, 15-30, 30-60, 60m+]
 *     so the user can see the shape of their build times at a
 *     glance.
 *   - Sub-line shows n (number of successful builds in window) so
 *     the median isn't read as "all my builds take this long" when
 *     it's actually based on only a handful.
 *
 * Target is interpreted as MINUTES (consistent with the unit in the
 * source spec). `op: "<="` works as you'd expect — "lead time
 * should be at most 15 minutes".
 *
 * Headline shows "—" rather than a fake 0 when no successful builds
 * exist (`medianMin === null`).
 */
export function LeadTimeWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
}) {
  const { data, isLoading, error, windowLabel } = useDataSource(spec.source);
  const needsScope = data?.needsScope === true;
  const medianMin = data?.medianMin ?? null;
  const histogram = data?.histogram || [];
  const n = data?.n ?? 0;
  const target = spec.source?.target;
  const hit =
    target && medianMin != null ? evalTarget(medianMin, target) : null;
  const maxN = Math.max(1, ...histogram.map((b) => b.n));

  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !needsScope && !isLoading && !error && medianMin != null
      ? {
          value: `${formatMin(medianMin)} median · n=${n}`,
          statusTone: hit === true ? "ok" : hit === false ? "warn" : "accent",
          statusLabel: hit === true ? "on target" : hit === false ? "above target" : "tracked",
        }
      : null,
  );

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Lead time · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} unit="min" variant={variant} />}
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
                fontSize: 50,
                letterSpacing: "-1.6px",
              }}
            >
              {error
                ? "!"
                : isLoading
                  ? "…"
                  : medianMin == null
                    ? "—"
                    : formatMin(medianMin)}
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
            {hit != null ? (
              <div
                className="ml-auto uppercase tracking-[0.5px]"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: hit ? "var(--accent-2)" : "rgba(255,255,255,0.7)",
                }}
              >
                {hit ? "on target" : "above target"}
              </div>
            ) : null}
          </div>
          {histogram.length > 0 && n > 0 ? (
            <div
              className="flex items-end gap-1"
              style={{ height: 36 }}
              aria-label="Duration distribution"
            >
              {histogram.map((b) => {
                const h = Math.max(2, (b.n / maxN) * 32);
                return (
                  <div
                    key={b.bin}
                    className="flex flex-1 flex-col items-center gap-0.5"
                  >
                    <span
                      className="w-full rounded-t-[2px]"
                      style={{
                        height: h,
                        background:
                          variant === "light"
                            ? "rgba(255,255,255,0.65)"
                            : "var(--accent)",
                      }}
                      title={`${b.n} build${b.n === 1 ? "" : "s"} in ${b.bin}`}
                    />
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 8.5,
                        color:
                          variant === "light"
                            ? "rgba(255,255,255,0.55)"
                            : "var(--dim-fg)",
                      }}
                    >
                      {b.bin}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color:
                variant === "light"
                  ? "rgba(255,255,255,0.6)"
                  : "var(--dim-fg)",
            }}
          >
            n = {n} successful build{n === 1 ? "" : "s"} in window
          </div>
        </div>
      )}
    </WidgetShell>
  );
}

/**
 * Pretty-print a minutes value. < 60 → "12m", < 1440 → "1h 23m",
 * ≥ 1440 → "2d 3h". Picked so the headline reads naturally for
 * everything from short CI jobs (~5m) to long Jenkins pipelines
 * with deploy approvals (~hours).
 */
function formatMin(min) {
  if (!Number.isFinite(min)) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min - h * 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const d = Math.floor(min / (24 * 60));
  const h = Math.round((min - d * 24 * 60) / 60);
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}
