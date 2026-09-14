"use client";

/**
 * CodeRubricWidget — AI-graded pull requests scored against a user-defined
 * rubric captured in `spec.context.answers`.
 *
 * All grading happens client-side via the `useGradedPrs` hook; this
 * component is purely presentational.
 */

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, Button, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import { WidgetShell } from "../widget-shell";
import { useGradedPrs } from "@/features/grading";
import { weekLabel, weekRangeFromLabel } from "@/lib/date";
import { usePublishGoalReading } from "../use-publish-reading";

export function CodeRubricWidget({ spec, goal, variant = "light", className, onRetry }) {
  // When the widget is rendered inside the SCORECARD modal (synthetic
  // spec carries `scopeKey`), pass that through to useGradedPrs so the
  // rubric hash matches what `useRubricForSlot` uses on the scorecard
  // row. Without this, grading from the modal stores verdicts under
  // one hash and the row reads under another — the user sees
  // different pass counts in the two places. spec.scopeKey is null
  // for the standalone widget so behaviour stays unchanged outside
  // SCORECARD.
  const {
    prs,
    verdictsByPr,
    rubric,
    summary,
    progress,
    isListLoading,
    verdictsFetched,
    listError,
    grade,
    gradeAll,
    refreshList,
    hasGithub,
  } = useGradedPrs(spec, {
    scopeKey: spec?.scopeKey || null,
    firstReviewOnly:
      spec?.firstReviewOnly === true ? true : undefined,
  });

  // Publish the graded pass-rate for the Evidence board — the same "N% · P/T
  // passing" this widget shows (Evidence can't grade the PR list itself).
  //
  // The rubric loads in TWO stages: the PR list (isListLoading) AND the
  // verdict-cache hydration (verdictsFetched). Until BOTH settle, summary.total
  // reads 0 → pct null, indistinguishable from "resolved, nothing graded". We
  // must HOLD the store (not clear it) during that window — otherwise the tier
  // grader sees the reading disappear then reappear and re-grades, which
  // flickers the goal in and out of the Intelligence "needs you" queue.
  const isResolving = isListLoading || !verdictsFetched;
  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !spec?.scopeKey && summary && summary.pct != null && summary.total > 0
      ? {
          value: `${summary.pct}% · ${summary.pass}/${summary.total} passing`,
          statusTone: summary.pct >= 85 ? "ok" : summary.pct >= 60 ? "accent" : "warn",
          statusLabel: "graded",
        }
      : null,
    { hold: isResolving },
  );

  const [expandedPrId, setExpandedPrId] = useState(null);
  // PR list is COLLAPSED by default — the widget's headline (pass-rate
  // + Grade-now button + summary count) is the at-a-glance read; the
  // per-PR breakdown is the drill-down. This drops the widget's
  // baseline render height from ~600px to ~140px when there are 18+
  // PRs YTD, which lets the masonry packer place it next to short
  // siblings without ballooning a column.
  const [listOpen, setListOpen] = useState(false);

  const year = new Date().getFullYear();
  const label = `Rubric · ${year} YTD`;

  // "This week" is the current Sun → Fri work-week (matches the
  // check-in week boundaries — same `weekLabel` helper). The widget
  // surfaces it as a secondary stat so users see the slice they're
  // most likely to grade next, without losing the YTD anchor.
  const thisWeek = useMemo(() => {
    const lbl = weekLabel(new Date());
    return weekRangeFromLabel(lbl);
  }, []);
  const thisWeekPrs = useMemo(() => {
    if (!thisWeek) return [];
    const s = thisWeek.start.getTime();
    const e = thisWeek.end.getTime();
    return prs.filter((pr) => {
      if (!pr.mergedAt) return false;
      const t = new Date(pr.mergedAt).getTime();
      return t >= s && t < e;
    });
  }, [prs, thisWeek]);
  const thisWeekStats = useMemo(
    () => summarisePrs(thisWeekPrs, verdictsByPr),
    [thisWeekPrs, verdictsByPr],
  );

  // All weeks YTD that have at least one PR — drives the "pick a past
  // week" dropdown next to the Grade button. Sorted newest-first so
  // the current week sits at the top of the list.
  const allWeeksWithPrs = useMemo(() => {
    const byLabel = new Map();
    for (const pr of prs) {
      if (!pr.mergedAt) continue;
      const lbl = weekLabel(new Date(pr.mergedAt));
      if (!byLabel.has(lbl)) byLabel.set(lbl, []);
      byLabel.get(lbl).push(pr);
    }
    const out = [];
    for (const [lbl, weekPrs] of byLabel) {
      out.push({
        weekLabel: lbl,
        prs: weekPrs,
        stats: summarisePrs(weekPrs, verdictsByPr),
      });
    }
    // Wnn labels compare lexicographically within a year, so a plain
    // descending sort puts the most recent week first.
    out.sort((a, b) => b.weekLabel.localeCompare(a.weekLabel));
    return out;
  }, [prs, verdictsByPr]);

  // Empty / setup states come first — short-circuit before the grid.
  if (!hasGithub) {
    return (
      <WidgetShell spec={spec} variant={variant} label={label} title={goal?.title || spec.title} onRetry={onRetry} className={className}>
        <EmptyNote>Connect GitHub or GitLab to grade pull requests against your rubric.</EmptyNote>
      </WidgetShell>
    );
  }
  if (rubric.length === 0) {
    return (
      <WidgetShell spec={spec} variant={variant} label={label} title={goal?.title || spec.title} onRetry={onRetry} className={className}>
        <EmptyNote>
          Define your rubric first — use <strong>edit truths</strong> below, add one criterion per line, then come back here to grade.
        </EmptyNote>
      </WidgetShell>
    );
  }
  if (isListLoading && prs.length === 0) {
    return (
      <WidgetShell spec={spec} variant={variant} label={label} title={goal?.title || spec.title} onRetry={onRetry} className={className}>
        <EmptyNote>Reading your PRs…</EmptyNote>
      </WidgetShell>
    );
  }
  if (listError) {
    const msg = listError?.message || String(listError);
    const isRateLimit =
      /rate limit|403/i.test(msg) || /secondary rate/i.test(msg);
    return (
      <WidgetShell spec={spec} variant={variant} label={label} title={goal?.title || spec.title} onRetry={onRetry} className={className}>
        <div className="flex h-full flex-col justify-between gap-2">
          <EmptyNote>
            {isRateLimit ? (
              <>
                Provider rate limit hit — the grader pauses and retries automatically; wait a moment and press <strong>Retry</strong>{" "}
                if it stalls.
                <br />
                <span className="text-[11px] text-dim-fg">{msg.slice(0, 180)}</span>
              </>
            ) : (
              <>Could not load PRs: {msg}</>
            )}
          </EmptyNote>
          <Button size="sm" className="self-start" onClick={refreshList}>
            Retry
          </Button>
        </div>
      </WidgetShell>
    );
  }
  if (prs.length === 0) {
    return (
      <WidgetShell spec={spec} variant={variant} label={label} title={goal?.title || spec.title} onRetry={onRetry} className={className}>
        <EmptyNote>No PRs authored by you since Jan 1 — nothing to grade yet.</EmptyNote>
      </WidgetShell>
    );
  }

  const hasUngraded = summary.ungraded > 0;
  const hasUngradedThisWeek = thisWeekStats.ungraded > 0;
  const onGradeThisWeek = () => grade(thisWeekPrs);

  return (
    <WidgetShell
      spec={spec}
      variant={variant}
      label={`${label} · ${summary.pass}/${summary.total} passing${summary.errored ? ` · ${summary.errored} err` : ""}`}
      title={goal?.title || spec.title}
      onRetry={onRetry}
      className={className}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <PctRow pct={summary.pct} />
        <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-card-alt">
          <div className="h-full bg-ink" style={{ width: `${summary.pct ?? 0}%` }} />
        </div>
        <ThisWeekRow weekLabel={thisWeek?.weekLabel} stats={thisWeekStats} prCount={thisWeekPrs.length} />
        <GradeActionRow
          progress={progress}
          hasUngraded={hasUngraded}
          hasUngradedThisWeek={hasUngradedThisWeek}
          thisWeekUngraded={thisWeekStats.ungraded}
          ytdUngraded={summary.ungraded}
          onGradeThisWeek={onGradeThisWeek}
          onGradeAll={gradeAll}
          totalPrs={prs.length}
          allWeeksWithPrs={allWeeksWithPrs}
          onGradeWeek={(weekPrs) => grade(weekPrs)}
        />
        <ListDisclosure open={listOpen} count={prs.length} summary={summary} onToggle={() => setListOpen((v) => !v)} />
        {listOpen ? (
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1 text-[13px]" style={{ maxHeight: 320 }}>
            {prs.map((pr) => (
              <PrRow
                key={pr.id}
                pr={pr}
                verdict={verdictsByPr.get(pr.id)}
                expanded={expandedPrId === pr.id}
                onToggle={() => setExpandedPrId((id) => (id === pr.id ? null : pr.id))}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </WidgetShell>
  );
}

function PctRow({ pct }) {
  return (
    <div className="flex items-baseline gap-2">
      <div className="text-[30px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-fg sm:text-[36px]">
        {pct == null ? "—" : `${pct}%`}
      </div>
      <Label>pass rate</Label>
    </div>
  );
}

/**
 * Inline summary of the current Sun → Fri work-week. Always rendered
 * so the YTD headline number sits alongside the granularity users are
 * being asked to grade — even when no PRs were merged this week,
 * showing "0 PRs merged" is more informative than the row vanishing
 * (which made the user think the per-week framing wasn't deployed).
 */
function ThisWeekRow({ weekLabel, stats, prCount }) {
  let right;
  if (prCount === 0) {
    right = "0 PRs merged";
  } else if (stats.graded === 0) {
    right = `${prCount} to grade`;
  } else {
    right = `${stats.pass}/${stats.graded} pass${stats.ungraded > 0 ? ` · ${stats.ungraded} to grade` : ""}`;
  }
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12.5px] text-muted-fg">
      <span>This week{weekLabel ? ` · ${weekLabel}` : ""}</span>
      <span className="text-fg">{right}</span>
    </div>
  );
}

/**
 * Three-control action row:
 *   - "Grade week (N)"  — primary, targets the current ISO week
 *   - week-picker chevron — opens a list of all past weeks with PRs;
 *                           click any row to grade just that week
 *   - "YTD (M)"         — escape hatch to grade everything ungraded
 *
 * Disabling logic:
 *   - all controls disabled while a grade pass is running (progress.running)
 *   - "this week" disabled when no ungraded PRs merged in current week
 *   - per-week rows in the picker disabled when that week is fully graded
 *   - "YTD"  disabled when nothing is ungraded anywhere
 *
 * When everything's graded both collapse to "All graded".
 */
function GradeActionRow({
  progress,
  hasUngraded,
  hasUngradedThisWeek,
  thisWeekUngraded,
  ytdUngraded,
  onGradeThisWeek,
  onGradeAll,
  totalPrs,
  allWeeksWithPrs,
  onGradeWeek,
}) {
  const running = progress.running;
  const thisWeekDisabled = running || !hasUngradedThisWeek;
  const ytdDisabled = running || !hasUngraded;
  // Past-week picker is meaningful when there are weeks WITH PRs other
  // than the current one. If there's only the current week, the
  // "Grade week" button already covers it — hide the chevron.
  const hasPastWeeks = (allWeeksWithPrs?.length || 0) > 1;

  let thisWeekLabel;
  if (running) thisWeekLabel = `Grading ${progress.done}/${progress.total}…`;
  else if (hasUngradedThisWeek) thisWeekLabel = `Grade week (${thisWeekUngraded})`;
  else thisWeekLabel = "Week done";

  let ytdLabel;
  if (running) ytdLabel = "…";
  else if (hasUngraded) ytdLabel = `YTD (${ytdUngraded})`;
  else ytdLabel = "All graded";

  return (
    <div className="flex items-center justify-between gap-2">
      <Label>
        {totalPrs} PR{totalPrs === 1 ? "" : "s"} YTD
      </Label>
      <div className="flex items-center gap-1.5">
        {/* Primary button + adjacent chevron form a "split button":
            click the wide part → grade this week; click the chevron
            → pick a different past week. The chevron is its own
            Popover.Trigger so the wide button keeps its straight
            onClick handler. */}
        <div className="flex items-stretch">
          <Button
            size="sm"
            disabled={thisWeekDisabled}
            className={hasPastWeeks ? "rounded-r-none pr-3" : ""}
            onClick={onGradeThisWeek}
          >
            {thisWeekLabel}
          </Button>
          {hasPastWeeks ? <WeekPickerDropdown running={running} weeks={allWeeksWithPrs} onPick={onGradeWeek} /> : null}
        </div>
        <Button size="sm" variant="soft" disabled={ytdDisabled} title={ytdDisabled && !hasUngraded ? "Nothing left to grade" : "Grade everything ungraded this year"} onClick={onGradeAll}>
          {ytdLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Past-week picker. Lists every week YTD that has at least one merged
 * PR, sorted newest-first. Each row shows pass/total + ungraded count;
 * fully-graded weeks are visible but disabled so the user can still
 * see them without accidentally re-grading. Picking a week fires
 * `onPick(weekPrs)` immediately — there's no two-step "confirm" UX.
 */
function WeekPickerDropdown({ running, weeks, onPick }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={running}
          aria-label="Pick a past week to grade"
          className="rounded-r-[var(--radius-pill)] bg-ink px-2 text-ink-on transition-opacity disabled:opacity-40"
        >
          <ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[280px] overflow-hidden rounded-[var(--radius-lg)] bg-card"
          style={{ boxShadow: "var(--shadow-float)", maxHeight: 320, overflowY: "auto" }}
        >
          <div className="border-b border-line px-3 py-2">
            <Label>Grade a specific week</Label>
          </div>
          <ul className="flex flex-col">
            {weeks.map((w) => {
              const fullyGraded = w.stats.ungraded === 0;
              return (
                <li key={w.weekLabel}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!fullyGraded) onPick(w.prs);
                    }}
                    disabled={fullyGraded}
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition-opacity hover:bg-card-alt disabled:opacity-50"
                  >
                    <span className="font-bold text-fg">{w.weekLabel}</span>
                    <span className="text-muted-fg">
                      {fullyGraded
                        ? `${w.stats.pass}/${w.stats.graded} · all graded`
                        : w.stats.graded === 0
                          ? `${w.prs.length} PR${w.prs.length === 1 ? "" : "s"} · ${w.stats.ungraded} to grade`
                          : `${w.stats.pass}/${w.stats.graded} pass · ${w.stats.ungraded} to grade`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Same shape as the check-in's `summariseVerdicts` — kept inlined
 * here rather than imported so the widget bundle doesn't pull in the
 * check-in tree. If we ever extract this to a shared helper, the
 * canonical home is `apps/web/src/features/grading/summary.js`.
 */
function summarisePrs(prList, verdictsByPr) {
  let pass = 0;
  let graded = 0;
  let errored = 0;
  for (const pr of prList) {
    const v = verdictsByPr.get(pr.id);
    if (!v) continue;
    if (v.errored) {
      errored += 1;
      continue;
    }
    graded += 1;
    if (v.pass) pass += 1;
  }
  return {
    pass,
    graded,
    errored,
    ungraded: prList.length - graded - errored,
  };
}

/**
 * Toggle row that expands / collapses the per-PR breakdown list.
 * Always renders so users see "X graded · Y ungraded" even when the
 * list is collapsed — the count gives them the gist; expand to see
 * which PRs.
 */
function ListDisclosure({ open, count, summary, onToggle }) {
  const passCount = summary?.pass ?? 0;
  const failCount = (summary?.total ?? 0) - passCount;
  const ungraded = summary?.ungraded ?? 0;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="group flex items-center justify-between gap-2 border-t border-line pt-2 text-left">
      <span className="flex items-baseline gap-1.5 text-[12.5px] text-muted-fg">
        <ChevronRight size={13} className={cn("shrink-0 text-fg transition-transform", open && "rotate-90")} aria-hidden="true" />
        <span className="font-bold text-fg">{open ? "Hide PRs" : "Show PRs"}</span>
        <span>·</span>
        <span>
          {passCount} pass · {failCount} fail
          {ungraded > 0 ? ` · ${ungraded} ungraded` : ""}
        </span>
      </span>
      <Label>{count} total</Label>
    </button>
  );
}

function PrRow({ pr, verdict, expanded, onToggle }) {
  return (
    <li className="flex flex-col">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 py-1 text-left text-fg">
        <span className="w-[46px] shrink-0 font-mono font-bold text-lav-ink">#{pr.number}</span>
        <span className="flex-1 truncate" title={pr.title}>
          {pr.title}
        </span>
        <VerdictBadge verdict={verdict} />
        <span className="shrink-0 text-[11px] text-dim-fg">{pr.state}</span>
      </button>
      {expanded && verdict ? (
        <div className="mb-1 ml-[54px] rounded-[var(--radius-md)] bg-card-alt px-2.5 py-2 text-[12px] leading-[1.45] text-muted-fg">
          <div className="mb-1 text-fg">{verdict.reasoning || "(no reasoning)"}</div>
          {verdict.violations?.length ? (
            <ul className="list-inside list-disc">
              {verdict.violations.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          ) : null}
          {pr.htmlUrl ? (
            <a href={pr.htmlUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block font-bold text-fg">
              Open
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function VerdictBadge({ verdict }) {
  if (!verdict) return <span className="shrink-0 text-[11px] text-dim-fg">ungraded</span>;
  if (verdict.errored) {
    return (
      <span className="shrink-0 text-[11px] text-muted-fg" title={verdict.reasoning}>
        err
      </span>
    );
  }
  return (
    <Badge tone={verdict.pass ? "mint" : "peach"} className="shrink-0">
      {verdict.pass ? "Pass" : "Fail"}
    </Badge>
  );
}

function EmptyNote({ children }) {
  return <div className="flex h-full items-center text-[13px] leading-[1.5] text-muted-fg">{children}</div>;
}
