"use client";

/**
 * Per-week CODE_RUBRIC editors for the weekly check-in.
 *
 * Two surfaces:
 *
 *   <CodeRubricEditor>          single-week inline editor (used by
 *                               /dev/checkin's GoalRow). Shows the PRs
 *                               merged in the active week + a "Grade
 *                               week" action that runs the AI grader
 *                               against just those PRs.
 *
 *   <CodeRubricGridRow>         full grid row (used by /dev/checkin/grid).
 *                               Calls useGradedPrs ONCE per row, then
 *                               partitions its PR list into the displayed
 *                               weeks. Each cell shows N/M pass count
 *                               + a per-week Analyze button. Last
 *                               column is a "Grade all weeks" CTA.
 *
 * Design notes
 * ────────────
 * - useGradedPrs fetches the user's PRs from Jan 1 of the current
 *   year ONCE per hook instance. Calling it inside each grid cell
 *   would fire 12+ parallel GitHub search-API requests per row, which
 *   the API would rate-limit (30 req/min). So the grid uses ONE hook
 *   call at the row level and filters in JS by `mergedAt`.
 *
 * - The new `grade(subset)` action on useGradedPrs (introduced
 *   alongside this file) lets us run the AI grader against any list
 *   of PRs, not just "all ungraded". The dashboard widget still uses
 *   `gradeAll()` for the year-wide flow.
 */

import { useCallback, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Sparkles, ChevronDown, Check } from "lucide-react";
import { useGradedPrs } from "@/features/grading";
import { cn } from "@/lib/cn";

const CELL_FONT = { fontFamily: "var(--font-mono)" };

/* ─────────────────────── single-week editor ─────────────────────── */

export function CodeRubricEditor({ spec, weekStart, weekEnd }) {
  const {
    prs,
    verdictsByPr,
    rubric,
    progress,
    isListLoading,
    listError,
    grade,
    hasGithub,
    firstReviewOnly,
  } = useGradedPrs(spec);

  const weekPrs = useMemo(
    () => filterPrsByMerged(prs, weekStart, weekEnd),
    [prs, weekStart, weekEnd],
  );
  const stats = useMemo(
    () => summariseVerdicts(weekPrs, verdictsByPr),
    [weekPrs, verdictsByPr],
  );

  const onAnalyze = useCallback(() => grade(weekPrs), [grade, weekPrs]);
  const disabled = !hasGithub || rubric.length === 0 || weekPrs.length === 0 || progress.running;

  if (!hasGithub) {
    return <Stub message="Connect GitHub to grade PRs." />;
  }
  if (rubric.length === 0) {
    return <Stub message="Define rubric criteria via the dashboard widget first." />;
  }
  if (isListLoading && prs.length === 0) {
    return <Stub message="Loading your PRs…" />;
  }
  if (listError && prs.length === 0) {
    return <Stub message={`Couldn't load PRs: ${listError.message || "unknown"}`} />;
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div
        className="flex items-baseline justify-between text-[11px] text-muted-fg"
        style={CELL_FONT}
      >
        <span>
          {weekPrs.length} PR{weekPrs.length === 1 ? "" : "s"} merged this week
          {firstReviewOnly && (
            <span className="ml-1 opacity-70">· first-review only</span>
          )}
        </span>
        {weekPrs.length > 0 && (
          <span>
            {stats.pass} / {stats.graded} pass
            {stats.ungraded > 0 && ` · ${stats.ungraded} ungraded`}
          </span>
        )}
      </div>

      {weekPrs.length > 0 && (
        <ul className="flex max-h-[160px] flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-bg/40 p-1.5">
          {weekPrs.map((pr) => (
            <li
              key={pr.id}
              className="flex items-center gap-1.5 text-[11px]"
              style={CELL_FONT}
            >
              <VerdictPill verdict={verdictsByPr.get(pr.id)} />
              <span className="truncate text-fg" title={pr.title}>
                #{pr.number} {pr.title}
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onAnalyze}
        disabled={disabled}
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[10px] uppercase tracking-[0.5px] text-accent-on transition-opacity",
          disabled && "opacity-40",
        )}
        style={CELL_FONT}
      >
        <Sparkles size={11} />
        {progress.running
          ? `Grading ${progress.done}/${progress.total}…`
          : weekPrs.length === 0
          ? "No PRs this week"
          : stats.ungraded === 0
          ? "All graded"
          : `Analyze week (${stats.ungraded})`}
      </button>
    </div>
  );
}

/* ─────────────────────── grid row ─────────────────────── */

const LABEL_COL = 240;

export function CodeRubricGridRow({ goal, spec, weeks }) {
  const {
    prs,
    verdictsByPr,
    rubric,
    progress,
    isListLoading,
    grade,
    hasGithub,
  } = useGradedPrs(spec);

  // Bucket the year's PRs into the displayed weeks once. Each cell
  // reads its own slice from this map.
  const prsByWeek = useMemo(() => {
    const out = new Map(weeks.map((w) => [w.weekLabel, []]));
    for (const pr of prs) {
      const dt = pr.mergedAt;
      if (!dt) continue;
      const t = new Date(dt).getTime();
      for (const w of weeks) {
        if (t >= w.start.getTime() && t < w.end.getTime()) {
          out.get(w.weekLabel).push(pr);
          break;
        }
      }
    }
    return out;
  }, [prs, weeks]);

  const rowTotals = useMemo(() => {
    // Sum across the displayed weeks only — the dashboard widget's
    // YTD summary differs, this one is "in this frame".
    let pass = 0;
    let graded = 0;
    let ungraded = 0;
    for (const [, weekPrs] of prsByWeek) {
      const s = summariseVerdicts(weekPrs, verdictsByPr);
      pass += s.pass;
      graded += s.graded;
      ungraded += s.ungraded;
    }
    return { pass, graded, ungraded };
  }, [prsByWeek, verdictsByPr]);

  // "Next ungraded week" — the earliest week that has PRs AND at least
  // one ungraded verdict. Pressing the button grades JUST that week;
  // the user reviews the verdicts that drop in, then presses again
  // for the next.
  const nextUngradedWeek = useMemo(() => {
    for (const wk of weeks) {
      const weekPrs = prsByWeek.get(wk.weekLabel) || [];
      if (weekPrs.length === 0) continue;
      const s = summariseVerdicts(weekPrs, verdictsByPr);
      if (s.ungraded > 0) return { week: wk, weekPrs, ungraded: s.ungraded };
    }
    return null;
  }, [weeks, prsByWeek, verdictsByPr]);

  const gradeNextWeek = useCallback(() => {
    if (nextUngradedWeek) grade(nextUngradedWeek.weekPrs);
  }, [grade, nextUngradedWeek]);

  const disabledNext = !hasGithub || rubric.length === 0 || !nextUngradedWeek || progress.running;

  // Multi-select state. Toggling a week's checkbox adds/removes it
  // from this Set. When the Set has ≥1 entries, the trailing column
  // flips from "Next · Wnn" to "Grade selected (N)". Pressing it
  // flattens the selected weeks' PRs into one grade() call. Selection
  // clears after the grade completes.
  const [selectedWeeks, setSelectedWeeks] = useState(() => new Set());
  const toggleSelect = useCallback((weekLabel) => {
    setSelectedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekLabel)) next.delete(weekLabel);
      else next.add(weekLabel);
      return next;
    });
  }, []);
  const selectedCount = selectedWeeks.size;
  const selectedStats = useMemo(() => {
    let ungraded = 0;
    for (const lbl of selectedWeeks) {
      const weekPrs = prsByWeek.get(lbl) || [];
      ungraded += summariseVerdicts(weekPrs, verdictsByPr).ungraded;
    }
    return { ungraded };
  }, [selectedWeeks, prsByWeek, verdictsByPr]);

  const gradeSelected = useCallback(() => {
    if (selectedCount === 0) return;
    const flat = [];
    for (const lbl of selectedWeeks) {
      const weekPrs = prsByWeek.get(lbl) || [];
      flat.push(...weekPrs);
    }
    grade(flat);
    // Clear selection after kicking off — the user sees grading
    // progress on the trailing button, and any week with new
    // verdicts updates its checkbox availability automatically.
    setSelectedWeeks(new Set());
  }, [grade, selectedCount, selectedWeeks, prsByWeek]);

  const disabledSelected =
    !hasGithub ||
    rubric.length === 0 ||
    selectedStats.ungraded === 0 ||
    progress.running;

  return (
    <>
      <div
        className="sticky left-0 z-10 flex items-center gap-2 border-b border-r border-border bg-bg px-3 py-2"
        style={{ minWidth: LABEL_COL }}
      >
        <span
          className="rounded-[3px] border border-border px-1 py-px text-[9px] uppercase tracking-[0.6px] text-muted-fg"
          style={CELL_FONT}
        >
          rubric
        </span>
        <span className="truncate text-[12px] font-medium text-fg" title={goal?.title}>
          {goal?.title || spec.title || "Untitled"}
        </span>
        <span className="ml-auto text-[10px] text-muted-fg/70" style={CELL_FONT}>
          {rowTotals.pass}/{rowTotals.graded} ✓
        </span>
      </div>

      {weeks.map((wk) => (
        <CodeRubricCell
          key={wk.weekLabel}
          week={wk}
          weekPrs={prsByWeek.get(wk.weekLabel) || []}
          verdictsByPr={verdictsByPr}
          hasGithub={hasGithub}
          rubricReady={rubric.length > 0}
          grade={grade}
          isListLoading={isListLoading}
          progress={progress}
          selected={selectedWeeks.has(wk.weekLabel)}
          onToggleSelect={() => toggleSelect(wk.weekLabel)}
        />
      ))}

      {/* Trailing column — context-sensitive CTA.
          - With ≥1 weeks checked: "Grade selected (N)" — flattens
            the selection's PRs into one grade() call.
          - With nothing checked: "Next · Wnn" jumper that targets the
            earliest ungraded week.
          - When all weeks are graded: "All graded" disabled state. */}
      <div className="flex items-center justify-end border-b border-border px-2">
        {selectedCount > 0 ? (
          <button
            type="button"
            onClick={gradeSelected}
            disabled={disabledSelected}
            title={
              rubric.length === 0
                ? "Define rubric in the dashboard widget first"
                : selectedStats.ungraded === 0
                ? "Selected weeks are already graded"
                : `Grade ${selectedStats.ungraded} ungraded across ${selectedCount} week${selectedCount === 1 ? "" : "s"}`
            }
            className={cn(
              "flex items-center gap-1 rounded-md border border-accent bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.4px] text-accent hover:bg-accent/20",
              disabledSelected && "opacity-40",
            )}
            style={CELL_FONT}
          >
            <Sparkles size={10} />
            {progress.running
              ? `${progress.done}/${progress.total}`
              : `Grade ${selectedCount} sel.`}
          </button>
        ) : (
          <button
            type="button"
            onClick={gradeNextWeek}
            disabled={disabledNext}
            title={
              rubric.length === 0
                ? "Define rubric in the dashboard widget first"
                : !nextUngradedWeek
                ? "All weeks graded"
                : `Grade ${nextUngradedWeek.week.weekLabel} (${nextUngradedWeek.ungraded} ungraded)`
            }
            className={cn(
              "flex items-center gap-1 rounded-md border border-border bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-[0.4px] text-muted-fg hover:bg-accent-dim/60 hover:text-fg",
              disabledNext && "opacity-40",
            )}
            style={CELL_FONT}
          >
            <Sparkles size={10} />
            {progress.running
              ? `${progress.done}/${progress.total}`
              : nextUngradedWeek
              ? `Next · ${nextUngradedWeek.week.weekLabel}`
              : "All graded"}
          </button>
        )}
      </div>
    </>
  );
}

/* ─────────────────────── per-week cell ─────────────────────── */

function CodeRubricCell({
  week,
  weekPrs,
  verdictsByPr,
  hasGithub,
  rubricReady,
  grade,
  isListLoading,
  progress,
  selected,
  onToggleSelect,
}) {
  const stats = useMemo(
    () => summariseVerdicts(weekPrs, verdictsByPr),
    [weekPrs, verdictsByPr],
  );
  const onAnalyze = useCallback(() => grade(weekPrs), [grade, weekPrs]);
  const disabled =
    !hasGithub ||
    !rubricReady ||
    weekPrs.length === 0 ||
    stats.ungraded === 0 ||
    progress.running;

  // Selection is disabled when the cell has no PRs OR every PR is
  // already graded — picking such a week wouldn't fire anything.
  const canSelect =
    hasGithub && rubricReady && weekPrs.length > 0 && stats.ungraded > 0;

  // Preview chip — what the cell shows when collapsed.
  const preview =
    !hasGithub || !rubricReady
      ? "—"
      : weekPrs.length === 0
      ? "0"
      : stats.graded === 0
      ? `${weekPrs.length} ⃝`
      : `${stats.pass}/${stats.graded}${
          stats.ungraded > 0 ? ` · ${stats.ungraded}⃝` : ""
        }`;

  const tone =
    stats.graded > 0 && stats.pass === stats.graded
      ? "border-success/40 bg-success/5"
      : stats.graded > 0 && stats.pass < stats.graded
      ? "border-amber/40 bg-amber/5"
      : "bg-bg";

  return (
    <div
      className={cn(
        "relative flex items-center justify-center border-b border-r border-border px-2 py-1.5",
        selected ? "bg-accent/10" : "bg-bg/40",
      )}
      style={{ minHeight: 52 }}
    >
      {/* Multi-select checkbox — top-left corner of the cell. Doesn't
          interfere with the popover trigger since it's positioned
          absolutely and its own click handler stops propagation. */}
      {canSelect ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.();
          }}
          aria-label={
            selected ? `Deselect ${week.weekLabel}` : `Select ${week.weekLabel}`
          }
          aria-pressed={selected}
          className={cn(
            "absolute left-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors",
            selected
              ? "border-accent bg-accent text-accent-on"
              : "border-border bg-bg text-transparent hover:border-accent/50",
          )}
        >
          <Check size={9} strokeWidth={3} />
        </button>
      ) : null}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px]",
              "hover:bg-accent-dim/40",
              tone,
            )}
            style={CELL_FONT}
            disabled={!hasGithub || weekPrs.length === 0}
          >
            <span className="font-semibold text-fg">{preview}</span>
            {weekPrs.length > 0 && <ChevronDown size={10} className="text-muted-fg" />}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 flex w-[280px] flex-col gap-1.5 rounded-md border border-border bg-bg p-2 shadow-lg"
          >
            <div
              className="flex items-baseline justify-between text-[11px] text-muted-fg"
              style={CELL_FONT}
            >
              <span>
                {week.weekLabel} · {weekPrs.length} PR
                {weekPrs.length === 1 ? "" : "s"}
              </span>
              <span>
                {stats.pass} / {stats.graded} pass
              </span>
            </div>
            {weekPrs.length > 0 && (
              <ul className="flex max-h-[140px] flex-col gap-0.5 overflow-y-auto rounded-md bg-bg/40 p-1.5">
                {weekPrs.map((pr) => (
                  <li
                    key={pr.id}
                    className="flex items-center gap-1.5 text-[11px]"
                    style={CELL_FONT}
                  >
                    <VerdictPill verdict={verdictsByPr.get(pr.id)} />
                    <span className="truncate text-fg" title={pr.title}>
                      #{pr.number} {pr.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={onAnalyze}
              disabled={disabled}
              className={cn(
                "flex items-center justify-center gap-1 rounded-md bg-accent px-2 py-1 text-[10px] uppercase tracking-[0.4px] text-accent-on transition-opacity",
                disabled && "opacity-40",
              )}
              style={CELL_FONT}
            >
              <Sparkles size={11} />
              {progress.running
                ? `Grading ${progress.done}/${progress.total}…`
                : stats.ungraded === 0
                ? "All graded"
                : `Analyze (${stats.ungraded})`}
            </button>
            {isListLoading && (
              <span
                className="text-[10px] text-muted-fg/70"
                style={CELL_FONT}
              >
                still loading PR list…
              </span>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/* ─────────────────────── helpers ─────────────────────── */

function filterPrsByMerged(prs, start, end) {
  if (!Array.isArray(prs)) return [];
  const s = start.getTime();
  const e = end.getTime();
  return prs.filter((pr) => {
    if (!pr.mergedAt) return false;
    const t = new Date(pr.mergedAt).getTime();
    return t >= s && t < e;
  });
}

function summariseVerdicts(prList, verdictsByPr) {
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

function VerdictPill({ verdict }) {
  if (!verdict) {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full border border-border bg-bg"
        title="Ungraded"
      />
    );
  }
  if (verdict.errored) {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full bg-amber/70"
        title={verdict.reasoning || "Grading errored"}
      />
    );
  }
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        verdict.pass ? "bg-success" : "bg-amber",
      )}
      title={verdict.pass ? "Pass" : "Fail"}
    />
  );
}

function Stub({ message }) {
  return (
    <div
      className="rounded-md border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-fg/80"
      style={CELL_FONT}
    >
      {message}
    </div>
  );
}
