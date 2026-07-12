"use client";

import { LineSpark } from "@/components/ui";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { NeedsScopeBanner } from "./build-events-shared";
import { usePublishGoalReading } from "../use-publish-reading";

/**
 * AUTO widget — count of successful CI/CD builds (Jenkins) or
 * workflow runs (GitHub Actions) in the spec window, with 8-week
 * trend. Layout deliberately mirrors MergedCountWidget so users
 * read both widgets the same way; the underlying source differs.
 *
 * Scope:
 *   spec.source.provider === "jenkins"          requires filter.job
 *   spec.source.provider === "github_actions"   requires filter.repo
 * Until scope is set, render NeedsScopeBanner with a "set in Review
 * pane" affordance instead of a fake 0. Same UX as Phase B's repo
 * scope chip.
 */
export function DeployFrequencyWidget({
  spec,
  goal,
  variant = "light",
  className,
  onRetry,
}) {
  const { data, isLoading, error, windowLabel } = useDataSource(spec.source);
  const needsScope = data?.needsScope === true;
  const count = data?.count ?? null;
  const trend = data?.trend || [];
  const target = spec.source?.target;
  const hit = target && count != null ? evalTarget(count, target) : null;

  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !needsScope && !isLoading && !error && count != null
      ? {
          value: `${count} deploy${count === 1 ? "" : "s"} · ${windowLabel}`,
          statusTone: hit === true ? "ok" : hit === false ? "warn" : "accent",
          statusLabel: hit === true ? "on target" : hit === false ? "below target" : "tracked",
        }
      : null,
  );

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`Deploys · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      {needsScope ? (
        <NeedsScopeBanner provider={spec.source?.provider} variant={variant} />
      ) : (
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
              {error ? "!" : isLoading ? "…" : (count ?? 0)}
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
                color:
                  variant === "light"
                    ? "rgba(255,255,255,0.6)"
                    : "var(--dim-fg)",
              }}
            >
              Trend builds after 2+ weeks of deploys.
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
