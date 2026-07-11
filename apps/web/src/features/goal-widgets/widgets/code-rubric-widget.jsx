"use client";

/**
 * CodeRubricWidget — AI-graded pull requests scored against a user-defined
 * rubric captured in `spec.context.answers`.
 *
 * Visual shape (inverse theme):
 *   ┌──────────────────────────────────────────────┐
 *   │ RUBRIC · YTD · 14 of 18 passing              │
 *   │ [goal title]                                  │
 *   │ ───────────────                               │
 *   │ 78%  pass rate          [Grade now]          │
 *   │ ▓▓▓▓▓▓▓▓▓▓░░░                                │
 *   │ ─────                                         │
 *   │ #13  ESD-110 audit logging             ✓ pass│
 *   │ #11  ESD-108 rate limiting             ✗ fail│
 *   │      └─ reviewer concern unaddressed…        │
 *   │ …                                             │
 *   └──────────────────────────────────────────────┘
 *
 * All grading happens client-side via the `useGradedPrs` hook; this
 * component is purely presentational.
 */

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";
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
  usePublishGoalReading(
    goal?.id,
    spec.widget,
    !isListLoading && !spec?.scopeKey && summary && summary.pct != null && summary.total > 0
      ? {
          value: `${summary.pct}% · ${summary.pass}/${summary.total} passing`,
          statusTone: summary.pct >= 85 ? "ok" : summary.pct >= 60 ? "accent" : "warn",
          statusLabel: "graded",
        }
      : null,
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
      <WidgetShell
        spec={spec}
        variant={variant}
        label={label}
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <EmptyNote variant={variant}>
          Connect GitHub or GitLab to grade pull requests against your rubric.
        </EmptyNote>
      </WidgetShell>
    );
  }
  if (rubric.length === 0) {
    return (
      <WidgetShell
        spec={spec}
        variant={variant}
        label={label}
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <EmptyNote variant={variant}>
          Define your rubric first — use <strong>edit truths</strong> below,
          add one criterion per line, then come back here to grade.
        </EmptyNote>
      </WidgetShell>
    );
  }
  if (isListLoading && prs.length === 0) {
    return (
      <WidgetShell
        spec={spec}
        variant={variant}
        label={label}
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <EmptyNote variant={variant}>Reading your PRs…</EmptyNote>
      </WidgetShell>
    );
  }
  if (listError) {
    const msg = listError?.message || String(listError);
    const isRateLimit =
      /rate limit|403/i.test(msg) || /secondary rate/i.test(msg);
    return (
      <WidgetShell
        spec={spec}
        variant={variant}
        label={label}
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <div className="flex h-full flex-col justify-between gap-2">
          <EmptyNote variant={variant}>
            {isRateLimit ? (
              <>
                Provider rate limit hit — the grader pauses and retries
                automatically; wait a moment and press <strong>Retry</strong>{" "}
                if it stalls.
                <br />
                <span
                  style={{
                    fontSize: 10,
                    color:
                      variant === "light"
                        ? "rgba(255,255,255,0.55)"
                        : "var(--dim-fg)",
                  }}
                >
                  {msg.slice(0, 180)}
                </span>
              </>
            ) : (
              <>Could not load PRs: {msg}</>
            )}
          </EmptyNote>
          <button
            type="button"
            onClick={refreshList}
            className="self-start rounded-[var(--radius-sub)] px-3 py-1 uppercase font-bold transition-opacity"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.5px",
              background: variant === "light" ? "#ffffff" : "var(--accent)",
              color: variant === "light" ? "var(--accent)" : "var(--accent-on)",
            }}
          >
            Retry
          </button>
        </div>
      </WidgetShell>
    );
  }
  if (prs.length === 0) {
    return (
      <WidgetShell
        spec={spec}
        variant={variant}
        label={label}
        title={goal?.title || spec.title}
        onRetry={onRetry}
        className={className}
      >
        <EmptyNote variant={variant}>
          No PRs authored by you since Jan 1 — nothing to grade yet.
        </EmptyNote>
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
        <PctRow pct={summary.pct} variant={variant} />
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-full"
          style={{
            background:
              variant === "light" ? "rgba(255,255,255,0.18)" : "var(--border)",
          }}
        >
          <div
            className="h-full"
            style={{
              width: `${summary.pct ?? 0}%`,
              background:
                variant === "light" ? "#ffffff" : "var(--accent)",
            }}
          />
        </div>
        <ThisWeekRow
          variant={variant}
          weekLabel={thisWeek?.weekLabel}
          stats={thisWeekStats}
          prCount={thisWeekPrs.length}
        />
        <GradeActionRow
          variant={variant}
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
        <ListDisclosure
          variant={variant}
          open={listOpen}
          count={prs.length}
          summary={summary}
          onToggle={() => setListOpen((v) => !v)}
        />
        {listOpen ? (
          <ul
            className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              maxHeight: 320,
            }}
          >
            {prs.map((pr) => (
              <PrRow
                key={pr.id}
                pr={pr}
                verdict={verdictsByPr.get(pr.id)}
                expanded={expandedPrId === pr.id}
                onToggle={() =>
                  setExpandedPrId((id) => (id === pr.id ? null : pr.id))
                }
                variant={variant}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </WidgetShell>
  );
}

function PctRow({ pct, variant }) {
  return (
    <div className="flex items-baseline gap-2">
      <div
        className="font-semibold leading-none"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 44,
          letterSpacing: "-1.6px",
        }}
      >
        {pct == null ? "—" : `${pct}%`}
      </div>
      <div
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
        }}
      >
        pass rate
      </div>
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
function ThisWeekRow({ variant, weekLabel, stats, prCount }) {
  const muted =
    variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)";
  const fg = variant === "light" ? "#ffffff" : "var(--fg)";
  let right;
  if (prCount === 0) {
    right = "0 PRs merged";
  } else if (stats.graded === 0) {
    right = `${prCount} to grade`;
  } else {
    right = `${stats.pass}/${stats.graded} pass${
      stats.ungraded > 0 ? ` · ${stats.ungraded} to grade` : ""
    }`;
  }
  return (
    <div
      className="flex items-baseline justify-between gap-2"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: muted,
      }}
    >
      <span className="uppercase tracking-[0.4px]">
        This week{weekLabel ? ` · ${weekLabel}` : ""}
      </span>
      <span style={{ color: fg }}>{right}</span>
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
  variant,
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
  else if (hasUngradedThisWeek)
    thisWeekLabel = `Grade week (${thisWeekUngraded})`;
  else thisWeekLabel = "Week done";

  let ytdLabel;
  if (running) ytdLabel = "…";
  else if (hasUngraded) ytdLabel = `YTD (${ytdUngraded})`;
  else ytdLabel = "All graded";

  return (
    <div className="flex items-center justify-between gap-2">
      <div
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: variant === "light" ? "rgba(255,255,255,0.6)" : "var(--dim-fg)",
        }}
      >
        {totalPrs} PR{totalPrs === 1 ? "" : "s"} YTD
      </div>
      <div className="flex items-center gap-1.5">
        {/* Primary button + adjacent chevron form a "split button":
            click the wide part → grade this week; click the chevron
            → pick a different past week. The chevron is its own
            Popover.Trigger so the wide button keeps its straight
            onClick handler. */}
        <div className="flex items-stretch">
          <button
            type="button"
            onClick={onGradeThisWeek}
            disabled={thisWeekDisabled}
            className={
              hasPastWeeks
                ? "rounded-l-[var(--radius-sub)] px-3 py-1 uppercase font-bold transition-opacity disabled:opacity-40"
                : "rounded-[var(--radius-sub)] px-3 py-1 uppercase font-bold transition-opacity disabled:opacity-40"
            }
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.5px",
              background: variant === "light" ? "#ffffff" : "var(--accent)",
              color:
                variant === "light" ? "var(--accent)" : "var(--accent-on)",
            }}
          >
            {thisWeekLabel}
          </button>
          {hasPastWeeks ? (
            <WeekPickerDropdown
              variant={variant}
              running={running}
              weeks={allWeeksWithPrs}
              onPick={onGradeWeek}
            />
          ) : null}
        </div>
        <button
          type="button"
          onClick={onGradeAll}
          disabled={ytdDisabled}
          title={
            ytdDisabled && !hasUngraded
              ? "Nothing left to grade"
              : "Grade everything ungraded this year"
          }
          className="rounded-[var(--radius-sub)] border px-2 py-1 uppercase font-bold transition-opacity disabled:opacity-40"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            letterSpacing: "0.5px",
            background: "transparent",
            borderColor:
              variant === "light"
                ? "rgba(255,255,255,0.4)"
                : "var(--border)",
            color: variant === "light" ? "#ffffff" : "var(--fg)",
          }}
        >
          {ytdLabel}
        </button>
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
function WeekPickerDropdown({ variant, running, weeks, onPick }) {
  const triggerBg = variant === "light" ? "#ffffff" : "var(--accent)";
  const triggerFg = variant === "light" ? "var(--accent)" : "var(--accent-on)";
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={running}
          aria-label="Pick a past week to grade"
          className="rounded-r-[var(--radius-sub)] border-l px-1.5 py-1 transition-opacity disabled:opacity-40"
          style={{
            background: triggerBg,
            color: triggerFg,
            borderLeftColor:
              variant === "light" ? "rgba(0,0,0,0.10)" : "rgba(0,0,0,0.18)",
          }}
        >
          <ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[260px] rounded-md border shadow-lg"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            maxHeight: 320,
            overflowY: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          <div
            className="border-b px-2 py-1.5 uppercase tracking-[0.4px]"
            style={{
              borderColor: "var(--border)",
              fontSize: 9.5,
              color: "var(--muted-fg)",
            }}
          >
            Grade a specific week
          </div>
          <ul className="flex flex-col">
            {weeks.map((w) => {
              const fullyGraded = w.stats.ungraded === 0;
              const disabled = fullyGraded;
              return (
                <li key={w.weekLabel}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!disabled) onPick(w.prs);
                    }}
                    disabled={disabled}
                    className="flex w-full items-baseline justify-between gap-2 px-2 py-1.5 text-left transition-opacity disabled:opacity-50 hover:bg-accent-dim/30"
                  >
                    <span
                      className="font-semibold"
                      style={{ color: "var(--fg)" }}
                    >
                      {w.weekLabel}
                    </span>
                    <span style={{ color: "var(--muted-fg)" }}>
                      {fullyGraded
                        ? `${w.stats.pass}/${w.stats.graded} · all graded`
                        : w.stats.graded === 0
                          ? `${w.prs.length} PR${
                              w.prs.length === 1 ? "" : "s"
                            } · ${w.stats.ungraded} to grade`
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
function ListDisclosure({ variant, open, count, summary, onToggle }) {
  const muted =
    variant === "light" ? "rgba(255,255,255,0.65)" : "var(--muted-fg)";
  const fg = variant === "light" ? "#ffffff" : "var(--fg)";
  const passCount = summary?.pass ?? 0;
  const failCount = (summary?.total ?? 0) - passCount;
  const ungraded = summary?.ungraded ?? 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="group flex items-center justify-between gap-2 border-t pt-2 text-left"
      style={{
        borderColor:
          variant === "light"
            ? "rgba(255,255,255,0.18)"
            : "var(--border)",
      }}
    >
      <span
        className="flex items-baseline gap-1.5"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: muted }}
      >
        <span
          aria-hidden="true"
          className="inline-block transition-transform"
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transitionDuration: "200ms",
            transitionTimingFunction: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            color: fg,
          }}
        >
          ›
        </span>
        <span
          className="uppercase tracking-[0.4px] font-bold"
          style={{ color: fg }}
        >
          {open ? "Hide PRs" : "Show PRs"}
        </span>
        <span className="uppercase tracking-[0.4px]">·</span>
        <span className="uppercase tracking-[0.4px]">
          {passCount} pass · {failCount} fail
          {ungraded > 0 ? ` · ${ungraded} ungraded` : ""}
        </span>
      </span>
      <span
        className="uppercase tracking-[0.5px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: muted,
        }}
      >
        {count} total
      </span>
    </button>
  );
}

function PrRow({ pr, verdict, expanded, onToggle, variant }) {
  const muted = variant === "light" ? "rgba(255,255,255,0.62)" : "var(--muted-fg)";
  const dim = variant === "light" ? "rgba(255,255,255,0.42)" : "var(--dim-fg)";
  const fg = variant === "light" ? "#ffffff" : "var(--fg)";

  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 py-1 text-left"
        style={{ color: fg }}
      >
        <span
          className="shrink-0 font-bold"
          style={{
            color: variant === "light" ? "rgba(255,255,255,0.85)" : "var(--accent)",
            width: 46,
          }}
        >
          #{pr.number}
        </span>
        <span className="flex-1 truncate" title={pr.title}>
          {pr.title}
        </span>
        <VerdictBadge verdict={verdict} variant={variant} />
        <span
          className="shrink-0 uppercase"
          style={{ color: dim, fontSize: 9.5 }}
        >
          {pr.state}
        </span>
      </button>
      {expanded && verdict ? (
        <div
          className="ml-[54px] mb-1 rounded-[var(--radius-sub)] px-2 py-1.5"
          style={{
            background:
              variant === "light" ? "rgba(255,255,255,0.08)" : "var(--card-alt)",
            color: muted,
            fontSize: 10.5,
            lineHeight: 1.45,
          }}
        >
          <div style={{ color: fg, marginBottom: verdict.violations?.length ? 4 : 0 }}>
            {verdict.reasoning || "(no reasoning)"}
          </div>
          {verdict.violations?.length ? (
            <ul className="list-inside list-disc">
              {verdict.violations.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          ) : null}
          {pr.htmlUrl ? (
            <a
              href={pr.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block uppercase tracking-[0.5px]"
              style={{
                fontSize: 9.5,
                color: variant === "light" ? "rgba(255,255,255,0.85)" : "var(--accent)",
              }}
            >
              open ↗
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function VerdictBadge({ verdict, variant }) {
  if (!verdict) {
    return (
      <span
        className="shrink-0 uppercase"
        style={{
          color: variant === "light" ? "rgba(255,255,255,0.5)" : "var(--dim-fg)",
          fontSize: 9.5,
        }}
      >
        ungraded
      </span>
    );
  }
  if (verdict.errored) {
    return (
      <span
        className="shrink-0 uppercase"
        title={verdict.reasoning}
        style={{
          color: variant === "light" ? "rgba(255,255,255,0.62)" : "var(--muted-fg)",
          fontSize: 9.5,
        }}
      >
        err
      </span>
    );
  }
  return (
    <span
      className="shrink-0 font-bold uppercase"
      style={{
        color: verdict.pass
          ? "var(--accent-2)"
          : variant === "light"
            ? "#ffffff"
            : "var(--bad)",
        fontSize: 10,
      }}
    >
      {verdict.pass ? "✓ pass" : "✗ fail"}
    </span>
  );
}

function EmptyNote({ children, variant }) {
  return (
    <div
      className="flex h-full items-center"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        lineHeight: 1.5,
        color: variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)",
      }}
    >
      {children}
    </div>
  );
}
