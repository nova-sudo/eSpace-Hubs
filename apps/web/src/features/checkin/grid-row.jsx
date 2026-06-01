"use client";

/**
 * One row of the catch-up grid — sticky goal label + one cell per
 * week. The dispatcher picks the cell editor matching `spec.widget`
 * (manual editors write to goal-inputs; auto cells read from the
 * pre-filtered integration data for that week).
 *
 * The row also exposes a small "copy from W##" dropdown that takes
 * any one cell's current value and broadcasts it into every other
 * empty cell in the same row. The single highest-leverage feature for
 * steady-state metrics where the dev's contribution doesn't really
 * change week-to-week (morale rating, weekly mentor count, etc.).
 */

import { useMemo } from "react";
import { SPEC_KINDS } from "@/features/goal-specs";
import {
  avgReviewerComments,
  firstPassRatePct,
  linkagePct,
  medianTurnaroundDays,
} from "@/features/integrations";
import { useGoalInputs } from "@/features/goal-inputs";
import { midWeekTs } from "@/lib/date";
import {
  AutoCell,
  BeforeAfterCell,
  CounterCell,
  DateLogCell,
  FreeTextCell,
  IncidentLogCell,
  MilestoneCell,
  RecurringMilestoneCell,
  ScaleCell,
  StubCell,
} from "./grid-cells";
import { CodeRubricGridRow } from "./code-rubric-row";

/**
 * Manual widgets whose (goal, week) cell is "filled" only once the user
 * logs an input for that week. Auto widgets read from integration data
 * and are never flagged unfilled. Exported so the grid page can compute
 * which week columns still have gaps for the "jump to next gap" control.
 */
export const MANUAL_GRID_WIDGETS = new Set([
  SPEC_KINDS.COUNTER,
  SPEC_KINDS.SCALE,
  SPEC_KINDS.MILESTONE,
  SPEC_KINDS.FREE_TEXT,
  SPEC_KINDS.DATE_LOG,
  SPEC_KINDS.BEFORE_AFTER,
  SPEC_KINDS.INCIDENT_LOG,
  SPEC_KINDS.RECURRING_MILESTONE,
]);

/** True when at least one goal-input entry falls inside the week window. */
export function hasEntryInWindow(entries, start, end) {
  if (!Array.isArray(entries)) return false;
  const s = start.getTime();
  const e = end.getTime();
  return entries.some((x) => x && x.ts >= s && x.ts < e);
}

export function GridRow({ goal, spec, weeks, mrsByWeek, eventsByWeek, ticketsCount }) {
  // Row-level goal-inputs read powers the "unfilled" indicator on manual
  // cells. Called unconditionally (before the CODE_RUBRIC early return)
  // to satisfy the rules of hooks; unused for auto / rubric rows.
  const { entries } = useGoalInputs(goal?.id);

  // CODE_RUBRIC needs row-level state: one useGradedPrs hook call per
  // row (a fetch per cell would hammer the GitHub search API). Delegate
  // the whole row to the dedicated component which owns its label, its
  // per-week cells, and its trailing bulk-action column.
  if (spec.widget === SPEC_KINDS.CODE_RUBRIC) {
    return <CodeRubricGridRow goal={goal} spec={spec} weeks={weeks} />;
  }

  const isManual = MANUAL_GRID_WIDGETS.has(spec.widget);

  return (
    <>
      <RowLabel goal={goal} spec={spec} />
      {weeks.map((wk) => (
        <GridCell
          key={wk.weekLabel}
          goal={goal}
          spec={spec}
          week={wk}
          mrsThisWeek={mrsByWeek.get(wk.weekLabel) || []}
          eventsThisWeek={eventsByWeek.get(wk.weekLabel) || []}
          ticketsCount={ticketsCount}
          empty={isManual && !hasEntryInWindow(entries, wk.start, wk.end)}
        />
      ))}
    </>
  );
}

/* ─────────────────────── label column ─────────────────────── */

function RowLabel({ goal, spec }) {
  const widget = spec.widget;
  return (
    <div
      className="sticky left-0 z-10 flex items-center gap-2 border-b border-r border-border bg-bg px-3 py-2"
      style={{ minWidth: 240 }}
    >
      <span
        className="rounded-[3px] border border-border px-1 py-px text-[9px] uppercase tracking-[0.6px] text-muted-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {kindLabel(widget)}
      </span>
      <span className="truncate text-[12px] font-medium text-fg">
        {goal?.title || spec.title || "Untitled"}
      </span>
    </div>
  );
}

/* ─────────────────────── cell dispatcher ─────────────────────── */

function GridCell({
  goal,
  spec,
  week,
  mrsThisWeek,
  eventsThisWeek,
  ticketsCount,
  empty,
}) {
  return (
    <div
      className="relative flex items-center justify-center border-b border-r border-border bg-bg/40 px-2 py-1.5"
      style={{
        minHeight: 52,
        // Faint amber wash + a corner dot mark a manual cell with no
        // input for this week yet (item 2.2). Inline so it renders
        // regardless of whether an `amber` Tailwind token is defined.
        ...(empty ? { background: "rgba(245, 158, 11, 0.06)" } : {}),
      }}
    >
      {empty ? (
        <span
          className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full"
          style={{ background: "#f59e0b" }}
          title="Not filled for this week yet"
        />
      ) : null}
      <CellFor
        widget={spec.widget}
        goal={goal}
        spec={spec}
        weekStart={week.start}
        weekEnd={week.end}
        weekLabel={week.weekLabel}
        mrsThisWeek={mrsThisWeek}
        eventsThisWeek={eventsThisWeek}
        ticketsCount={ticketsCount}
      />
    </div>
  );
}

function CellFor({
  widget,
  goal,
  spec,
  weekStart,
  weekEnd,
  weekLabel,
  mrsThisWeek,
  ticketsCount,
}) {
  switch (widget) {
    case SPEC_KINDS.COUNTER:
      return <CounterCell goal={goal} weekStart={weekStart} weekEnd={weekEnd} weekLabel={weekLabel} />;
    case SPEC_KINDS.SCALE:
      return <ScaleCell goal={goal} weekStart={weekStart} weekEnd={weekEnd} weekLabel={weekLabel} />;
    case SPEC_KINDS.MILESTONE:
      return (
        <MilestoneCell
          goal={goal}
          spec={spec}
          weekStart={weekStart}
          weekEnd={weekEnd}
          weekLabel={weekLabel}
        />
      );
    case SPEC_KINDS.FREE_TEXT:
      return (
        <FreeTextCell goal={goal} weekStart={weekStart} weekEnd={weekEnd} weekLabel={weekLabel} />
      );
    case SPEC_KINDS.DATE_LOG:
      return (
        <DateLogCell goal={goal} weekStart={weekStart} weekEnd={weekEnd} weekLabel={weekLabel} />
      );
    case SPEC_KINDS.BEFORE_AFTER:
      return (
        <BeforeAfterCell
          goal={goal}
          weekStart={weekStart}
          weekEnd={weekEnd}
          weekLabel={weekLabel}
        />
      );

    case SPEC_KINDS.MERGED_COUNT:
      return (
        <AutoCell value={mrsThisWeek.length} unit="" target={spec.source?.target} />
      );
    case SPEC_KINDS.REVIEW_ROUNDS: {
      const v = avgReviewerComments(mrsThisWeek);
      return (
        <AutoCell
          value={v == null ? null : Number(v.toFixed(2))}
          unit="rds"
          target={spec.source?.target}
        />
      );
    }
    case SPEC_KINDS.TURNAROUND: {
      const days = medianTurnaroundDays(mrsThisWeek);
      const hours = days == null ? null : Math.round(days * 24);
      return <AutoCell value={hours} unit="h" target={spec.source?.target} />;
    }
    case SPEC_KINDS.LINKAGE: {
      const pct = linkagePct(mrsThisWeek)?.pct ?? null;
      return <AutoCell value={pct} unit="%" target={spec.source?.target} />;
    }
    case SPEC_KINDS.FIRST_PASS_RATE: {
      // firstPassRatePct returns `{ pct, clean, pingPong }` (or null
      // when there were no merges this week). Cells render scalars,
      // so unwrap to the .pct field.
      const result = firstPassRatePct(mrsThisWeek);
      return (
        <AutoCell
          value={result?.pct ?? null}
          unit="%"
          target={spec.source?.target}
        />
      );
    }
    case SPEC_KINDS.TICKET_CYCLE:
      return (
        <AutoCell value={ticketsCount} unit="tk" target={spec.source?.target} />
      );

    case SPEC_KINDS.INCIDENT_LOG:
      return (
        <IncidentLogCell
          goal={goal}
          spec={spec}
          weekStart={weekStart}
          weekEnd={weekEnd}
          weekLabel={weekLabel}
        />
      );

    case SPEC_KINDS.RECURRING_MILESTONE:
      return (
        <RecurringMilestoneCell
          goal={goal}
          spec={spec}
          weekLabel={weekLabel}
        />
      );

    // Widgets without inline-cell editors yet — placeholder.
    case SPEC_KINDS.CODE_RUBRIC:
    case SPEC_KINDS.SCORECARD:
    case SPEC_KINDS.DEPLOY_FREQUENCY:
    case SPEC_KINDS.LEAD_TIME:
    case SPEC_KINDS.BUILD_PASS_RATE:
      return <StubCell tooltip="Edit from the dashboard widget for now" />;

    default:
      return <StubCell tooltip={`No grid editor for "${widget}" yet`} />;
  }
}

/* ─────────────────────── chrome helpers ─────────────────────── */

function kindLabel(widget) {
  switch (widget) {
    case SPEC_KINDS.COUNTER:           return "counter";
    case SPEC_KINDS.SCALE:             return "scale";
    case SPEC_KINDS.MILESTONE:         return "milestone";
    case SPEC_KINDS.FREE_TEXT:         return "note";
    case SPEC_KINDS.DATE_LOG:          return "date-log";
    case SPEC_KINDS.BEFORE_AFTER:      return "before/after";
    case SPEC_KINDS.MERGED_COUNT:      return "merges";
    case SPEC_KINDS.REVIEW_ROUNDS:     return "rounds";
    case SPEC_KINDS.TURNAROUND:        return "turnaround";
    case SPEC_KINDS.LINKAGE:           return "linkage";
    case SPEC_KINDS.FIRST_PASS_RATE:   return "first-pass";
    case SPEC_KINDS.TICKET_CYCLE:      return "tickets";
    case SPEC_KINDS.INCIDENT_LOG:      return "incidents";
    case SPEC_KINDS.RECURRING_MILESTONE: return "recurring";
    case SPEC_KINDS.CODE_RUBRIC:       return "rubric";
    case SPEC_KINDS.SCORECARD:         return "scorecard";
    case SPEC_KINDS.DEPLOY_FREQUENCY:  return "deploys";
    case SPEC_KINDS.LEAD_TIME:         return "lead-time";
    case SPEC_KINDS.BUILD_PASS_RATE:   return "build-pass";
    default:                            return String(widget || "").toLowerCase().slice(0, 14);
  }
}

/* ─────────────────────── per-row "Copy from" button ─────────────────────── */

/**
 * Renders a small "Copy from" button at the end of a row. Reads ONE
 * source week's value and writes it into every other empty cell in
 * the same row that supports a copyable value (manual widgets only).
 *
 * Not a Radix dropdown — we expose it as a separate component so the
 * grid layout can place it in a dedicated trailing column.
 */
export function RowCopyButton({ goal, spec, weeks }) {
  const { entries, append } = useGoalInputs(goal?.id);

  const canCopy =
    spec.widget === SPEC_KINDS.COUNTER ||
    spec.widget === SPEC_KINDS.SCALE ||
    spec.widget === SPEC_KINDS.DATE_LOG;

  // Find the most recent week in range with a non-zero value.
  const sourceWeek = useMemo(() => {
    if (!canCopy) return null;
    for (let i = weeks.length - 1; i >= 0; i--) {
      const w = weeks[i];
      const v = readCellValue(entries, w.start, w.end, spec.widget);
      if (v != null && v !== 0 && v !== "") return { week: w, value: v };
    }
    return null;
  }, [entries, weeks, spec.widget, canCopy]);

  if (!canCopy || !sourceWeek) {
    return (
      <div
        className="flex items-center justify-end border-b border-border px-2 text-[10px] text-muted-fg/40"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        —
      </div>
    );
  }

  const onCopy = () => {
    for (const w of weeks) {
      if (w.weekLabel === sourceWeek.week.weekLabel) continue;
      const existing = readCellValue(entries, w.start, w.end, spec.widget);
      if (existing != null && existing !== 0 && existing !== "") continue;
      const ts = midWeekTs(w.weekLabel);
      if (ts == null) continue;
      append(sourceWeek.value, undefined, ts);
    }
  };

  return (
    <div className="flex items-center justify-end border-b border-border px-2">
      <button
        type="button"
        onClick={onCopy}
        title={`Fill empty cells with ${sourceWeek.value} from ${sourceWeek.week.weekLabel}`}
        className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-[10px] uppercase tracking-[0.4px] text-muted-fg hover:bg-accent-dim/60 hover:text-fg"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Copy ← {sourceWeek.week.weekLabel}
      </button>
    </div>
  );
}

function readCellValue(entries, start, end, widget) {
  const s = start.getTime();
  const e = end.getTime();
  const inWindow = entries.filter((entry) => entry.ts >= s && entry.ts < e);
  if (inWindow.length === 0) return null;

  if (widget === SPEC_KINDS.COUNTER) {
    let sum = 0;
    for (const entry of inWindow) {
      const n = Number(entry.value);
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }
  if (widget === SPEC_KINDS.SCALE) {
    const numbers = inWindow
      .filter((e) => Number.isFinite(Number(e.value)))
      .map((e) => Number(e.value));
    return numbers.length > 0 ? numbers[numbers.length - 1] : null;
  }
  if (widget === SPEC_KINDS.DATE_LOG) {
    return inWindow.length;
  }
  return null;
}
