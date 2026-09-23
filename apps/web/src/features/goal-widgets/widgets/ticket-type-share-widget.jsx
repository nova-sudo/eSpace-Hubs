"use client";

import { Badge } from "@/components/ui";
import { WidgetShell, TargetChip } from "../widget-shell";
import { useDataSource } from "../data-sources/use-data-source";
import { evalTarget } from "./merged-count-widget";
import { ComplianceLine } from "../compliance-line";
import { usePublishGoalReading } from "../use-publish-reading";

/**
 * Ticket-type share — merged PRs whose linked Jira ticket is a Bug (or any
 * type the spec names).
 *
 * Headline: share (%) or count of merged PRs in the window whose ticket matched
 * Sub:      matched / unresolved / total, plus which types were seen
 *
 * The ticket route to "how much of my work was bug fixing" — for teams that
 * link tickets but never label PRs. A PR with no key, or a key Jira didn't
 * return, is shown as unresolved rather than silently counted as "not a
 * bug"; the share is a floor over linked work and the chip says so.
 */
export function TicketTypeShareWidget({ spec, goal, variant = "light", className, onRetry }) {
  const { data, isLoading, error, windowLabel, provenance } = useDataSource(spec.source);
  const mode = data?.mode === "count" ? "count" : "share";
  const pct = data?.pct ?? null;
  const matched = data?.matched ?? 0;
  const unresolved = data?.unresolved ?? 0;
  const total = data?.total ?? 0;
  const seen = Array.isArray(data?.seenTypes) ? data.seenTypes : [];
  const watched = Array.isArray(data?.watchedTypes) ? data.watchedTypes : [];
  const jiraConnected = data?.jiraConnected !== false;
  const target = spec.source?.target;
  const headline = mode === "count" ? (total > 0 ? matched : null) : pct;
  const unit = mode === "count" ? "PRs" : "%";
  const meets = target && headline != null ? evalTarget(headline, target) : null;
  const noneMatched = headline === 0 && total > 0;

  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !isLoading && !error && headline != null
      ? {
          value:
            (mode === "count"
              ? `${matched} of ${total} merged PRs on a ${watched.join("/")} ticket`
              : `${pct}% of merged PRs on a ${watched.join("/")} ticket · ${matched} of ${total}`) +
            (unresolved > 0 ? ` · ${unresolved} unresolved` : "") +
            (seen.length ? ` · types seen: ${seen.join(", ")}` : ""),
          score: headline,
          unit,
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
      label={`${watched.join("/") || "Ticket"} PRs · ${windowLabel}`}
      title={goal?.title || spec.title}
      rightChip={<TargetChip target={target} unit={unit} variant={variant} />}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
            {isLoading
              ? "…"
              : headline == null
                ? "—"
                : mode === "count"
                  ? headline
                  : `${headline}%`}
          </div>
          {error ? (
            <Badge tone="neutral" className="ml-auto" title={error?.message || String(error)}>
              Source unavailable
            </Badge>
          ) : !jiraConnected ? (
            <Badge tone="lemon" className="ml-auto">
              Connect Jira
            </Badge>
          ) : meets != null ? (
            <Badge tone={meets ? "mint" : "peach"} className="ml-auto">
              {meets ? "On target" : "Below target"}
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-fg">
          <span>
            matched: <strong className="text-fg">{matched}</strong>
          </span>
          <span className="text-dim-fg">·</span>
          <span>
            unresolved: <strong className="text-fg">{unresolved}</strong>
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
          {!jiraConnected
            ? "Jira isn't connected, so no ticket can be typed. Connect it in settings."
            : noneMatched
              ? `No merged PR linked a ${watched.join(" or ")} ticket. That may mean none were, or the tickets are of another type.`
              : `Counting PRs whose Jira key is ${watched.join(" or ")}. Unlinked PRs count against the share and can't be typed.`}
        </p>

        <ComplianceLine goalId={goal?.id} variant={variant} />
      </div>
    </WidgetShell>
  );
}
