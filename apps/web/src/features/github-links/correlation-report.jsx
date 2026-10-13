"use client";

/**
 * <CorrelationReport data loading error actions /> — GitHub and eSpace side
 * by side, per goal, per period: the issue (the shared chip), its linked
 * PRs (merged / total), the newest eSpace reading, the grade, and a badge
 * wherever the two layers disagree (see `flagCopy`).
 *
 * `data` is the API's `{ goals }` (or the goals array itself). Presentation
 * only — the hub page feeds it from `useGithubCorrelation` /
 * `useReportGithubCorrelation`. Each goal is a borderless card; the period
 * table is a grid from `md` up and stacks into labelled rows on a phone.
 * `actions` lets the owner's chip offer Republish / Unlink; a manager's
 * view leaves it off.
 */

import { Badge, Card, Label } from "@/components/ui";
import { TIER_LABELS, tierTone } from "@/features/goal-tiers";
import { shortDate } from "@/lib/date";
import { cn } from "@/lib/cn";
import { GithubIssueChip } from "./issue-chip";
import {
  correlationChipLink,
  correlationSummary,
  correlationSummaryLine,
  flagCopy,
  prCountLabel,
  readingLabel,
} from "./link-model";

const COLS =
  "md:grid md:grid-cols-[minmax(96px,1fr)_64px_minmax(170px,1.6fr)_88px_minmax(116px,1fr)_minmax(104px,0.9fr)_minmax(120px,1.2fr)] md:items-center md:gap-3";

export function CorrelationReport({ data, loading = false, error = null, actions = false, className }) {
  const goals = Array.isArray(data) ? data : Array.isArray(data?.goals) ? data.goals : [];

  if (loading && goals.length === 0) {
    return <Note className={className}>Loading the GitHub report…</Note>;
  }
  if (error && goals.length === 0) {
    return (
      <Note className={className}>
        {error.message || "Couldn't load the GitHub report. Refresh to try again."}
      </Note>
    );
  }
  if (goals.length === 0) {
    return <Note className={className}>Nothing published to GitHub yet.</Note>;
  }

  const summary = correlationSummary(goals);
  const line = correlationSummaryLine(summary);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <p
        className={cn(
          "text-[13px] font-semibold leading-[1.5]",
          summary.flagged > 0 ? "text-fg" : "text-muted-fg",
        )}
      >
        {line}
      </p>
      {goals.map((goal) => (
        <GoalCard key={goal.goalId} goal={goal} actions={actions} />
      ))}
    </div>
  );
}

function Note({ children, className }) {
  return (
    <Card className={cn("text-[13px] leading-[1.6] text-muted-fg", className)}>{children}</Card>
  );
}

function GoalCard({ goal, actions }) {
  const periods = Array.isArray(goal.periods) ? goal.periods : [];
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex min-w-0 items-baseline gap-2">
        {goal.code ? (
          <span className="shrink-0 text-[12px] font-bold text-muted-fg">{goal.code}</span>
        ) : null}
        <span className="truncate text-[15px] font-bold text-fg" title={goal.title}>
          {goal.title}
        </span>
      </div>
      <div role="table" aria-label={`${goal.title} — GitHub and eSpace by period`}>
        <div role="row" className={cn(COLS, "hidden border-b border-line pb-2")}>
          <Label role="columnheader">Period</Label>
          <Label role="columnheader">Due</Label>
          <Label role="columnheader">GitHub issue</Label>
          <Label role="columnheader">PRs</Label>
          <Label role="columnheader">eSpace</Label>
          <Label role="columnheader">Grade</Label>
          <Label role="columnheader">Gaps</Label>
        </div>
        {periods.map((p) => (
          <PeriodRow key={p.periodIndex} period={p} actions={actions} />
        ))}
      </div>
    </Card>
  );
}

function Cell({ label, children, className }) {
  return (
    <div role="cell" className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="w-[72px] shrink-0 text-[11.5px] text-muted-fg md:hidden">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function PeriodRow({ period, actions }) {
  const link = correlationChipLink(period.issue);
  const flags = Array.isArray(period.flags) ? period.flags : [];
  const prs = Array.isArray(period.linkedPrs) ? period.linkedPrs : [];
  const merged = prs.filter((p) => p.state === "merged").length;

  return (
    <div
      role="row"
      className={cn(COLS, "flex flex-col gap-1.5 border-b border-line py-3 last:border-b-0")}
    >
      <div role="cell" className="min-w-0 truncate text-[13px] font-bold text-fg" title={period.label}>
        {period.label}
      </div>
      <Cell label="Due">
        <span className="text-[12.5px] tabular-nums text-muted-fg">
          {period.deadline ? shortDate(period.deadline) : "—"}
        </span>
      </Cell>
      <Cell label="GitHub">
        {link ? (
          <GithubIssueChip link={link} actions={actions} />
        ) : (
          <span className="text-[12.5px] text-muted-fg">Not published</span>
        )}
      </Cell>
      <Cell label="PRs">
        <span
          className={cn("text-[12.5px] tabular-nums", merged > 0 ? "text-fg" : "text-muted-fg")}
          title={prs.map((p) => `#${p.number} ${p.title}`).join("\n") || undefined}
        >
          {prCountLabel(prs)}
        </span>
      </Cell>
      <Cell label="eSpace">
        <span className="text-[12.5px] text-muted-fg">{readingLabel(period.reading)}</span>
      </Cell>
      <Cell label="Grade">
        {period.grade ? (
          <Badge
            tone={tierTone(period.grade.tier)}
            title={period.grade.by === "manager" ? "Graded by the manager" : "AI grade"}
          >
            {TIER_LABELS[period.grade.tier] || period.grade.tier}
            {period.grade.by === "ai" ? " · AI" : ""}
          </Badge>
        ) : (
          <span className="text-[12.5px] text-muted-fg">—</span>
        )}
      </Cell>
      <Cell label="Gaps">
        {flags.length ? (
          <span className="flex flex-wrap gap-1">
            {flags.map((f) => {
              const c = flagCopy(f);
              return (
                <Badge key={f} tone={c.tone} title={c.title}>
                  {c.label}
                </Badge>
              );
            })}
          </span>
        ) : (
          <span className="text-[12.5px] text-muted-fg">—</span>
        )}
      </Cell>
    </div>
  );
}
