"use client";

import { Badge } from "@/components/ui";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";
import { usePublishGoalReading } from "../use-publish-reading";

/**
 * Assisted share — merged pull requests carrying an assistant label.
 *
 * Headline: percentage of merged PRs in the window that were labelled
 * Sub:      the split, plus which labels were actually seen
 *
 * The honest framing matters more than usual here, because the number is
 * easy to over-read. A label says the tooling was involved in a pull
 * request; it says nothing about how much of the code it wrote or whether
 * the author understood it. And an assisted merge that was never labelled
 * is invisible, so the figure is a floor rather than a measurement. Both
 * caveats are on the widget and in what the grader is told, rather than
 * being left for someone to discover during a review conversation.
 */
export function AssistedShareWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { data, isLoading, error, windowLabel, provenance } = useDataSource(spec.source);
  const pct = data?.pct ?? null;
  const assisted = data?.assisted ?? 0;
  const total = data?.total ?? 0;
  const matched = Array.isArray(data?.matched) ? data.matched : [];
  const watched = Array.isArray(data?.watchedLabels) ? data.watchedLabels : [];
  const target = spec.source?.target;
  const meets = target && pct != null ? evalTarget(pct, target) : null;

  // Nothing matched across a non-empty window is ambiguous: either nobody
  // used an assistant, or the team labels them something this goal is not
  // watching. Saying "0%" alone would pick the first reading silently.
  const noneMatched = pct === 0 && total > 0;

  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !isLoading && !error && pct != null
      ? {
          value:
            `${pct}% of merged PRs labelled assisted · ${assisted} of ${total}` +
            (matched.length ? ` · labels seen: ${matched.join(", ")}` : "") +
            (noneMatched ? ` · no PR carried ${watched.join(" or ")}` : ""),
          score: pct,
          unit: "%",
          statusTone: meets === true ? "ok" : meets === false ? "warn" : "accent",
          statusLabel: meets === true ? "on target" : meets === false ? "below target" : "tracked",
          provenance,
        }
      : null,
  );

  return (
    <WidgetShell
      spec={spec}
      provenance={provenance}
      variant={variant}
      label={`Assisted merges · ${windowLabel}`}
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
            labelled: <strong className="text-fg">{assisted}</strong>
          </span>
          <span className="text-dim-fg">·</span>
          <span>
            of <strong className="text-fg">{total}</strong> merged
          </span>
        </div>

        <div className="flex h-2 w-full overflow-hidden rounded-full bg-card-alt">
          <div className="bg-ink" style={{ width: `${pct ?? 0}%` }} />
        </div>

        <p className="text-[11.5px] leading-snug text-dim-fg">
          {noneMatched
            ? `No merged PR carried ${watched.join(" or ")}. That may mean no assisted work, or a label this goal isn't watching.`
            : matched.length
              ? `Counting ${matched.join(", ")}. Unlabelled assisted merges can't be seen, so this is a lower bound.`
              : "Counts merged PRs labelled by assistant tooling."}
        </p>

        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}
