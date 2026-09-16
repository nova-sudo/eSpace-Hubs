"use client";

import { LineSpark, Badge } from "@/components/ui";
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
  const { data, isLoading, error, windowLabel, provenance } = useDataSource(spec.source);
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
          provenance,
        }
      : null,
  );

  return (
    <WidgetShell
      spec={spec}
      provenance={provenance}
      variant={variant}
      label={`Deploys · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      {needsScope ? (
        <NeedsScopeBanner provider={spec.source?.provider} />
      ) : (
        <div className="flex h-full flex-col justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
              {error ? "!" : isLoading ? "…" : (count ?? 0)}
            </div>
            {hit != null ? <Badge tone={hit ? "mint" : "peach"}>{hit ? "On target" : "Below target"}</Badge> : null}
          </div>
          {trend.length >= 2 ? (
            <LineSpark data={trend} color="var(--ink)" height={40} strokeWidth={2} fillOpacity={0.16} showDots />
          ) : (
            <div className="text-[12.5px] text-muted-fg">Trend builds after 2+ weeks of deploys.</div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
