"use client";

/**
 * Catch-up grid view.
 *
 * Rows = classified L2 goals (grouped under their L1 headers).
 * Columns = a range of work-weeks.
 * Cells = compact editor / read-only chip for that (goal, week) pair.
 *
 * Use case: cold-start backfill. The dev opens the page, sees every
 * empty week behind them at once, fills a few rows quickly (with
 * "Copy from" filling steady-state metrics in one click), and hits
 * Save all. The grid hides the per-week navigator overhead of the
 * single-week page when the dev needs to touch many weeks at once.
 *
 * Layout: CSS grid with sticky goal column (left) and sticky week
 * header (top). Scrolls in both directions when content overflows.
 */

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save, ChevronLeft, ChevronRight } from "lucide-react";
import { useGoals } from "@/features/goals";
import { useGoalSpecs } from "@/features/goal-specs";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import {
  useCombinedEventsSince,
  useCombinedMergedSince,
  useJiraTickets,
} from "@/features/integrations";
import { readInputs } from "@/features/goal-inputs";
import { synthesiseWeek } from "@/features/snapshots";
import { isoDaysAgo } from "@/lib/date";
import { useCheckinGridRange } from "./use-checkin-grid-range";
import { GridRow, RowCopyButton } from "./grid-row";

const LABEL_COL = 240;
const CELL_COL = 130;
const ACTION_COL = 120;

export function CheckinGridPage() {
  const { weeks, fromLabel, toLabel, setRange, presetLastN } = useCheckinGridRange();

  const { goals } = useGoals();
  const { specs } = useGoalSpecs();
  const { groupedItems, hasGoals, hasSpecs } = useGoalWidgetItems();

  const { data: mrs } = useCombinedMergedSince(isoDaysAgo(365));
  const { data: events } = useCombinedEventsSince(isoDaysAgo(90));
  const { data: jira } = useJiraTickets();
  const tickets = Array.isArray(jira?.issues) ? jira.issues : [];

  // Bucket MR / event data per week ONCE for the whole grid — way
  // cheaper than each cell re-filtering its own slice.
  const mrsByWeek = useMemo(() => bucketByWeek(mrs, weeks, (m) => m?.merged_at), [mrs, weeks]);
  const eventsByWeek = useMemo(
    () => bucketByWeek(events, weeks, (e) => e?.created_at),
    [events, weeks],
  );

  const [saving, setSaving] = useState(false);
  const onSaveAll = useCallback(async () => {
    if (!hasSpecs) {
      toast.info("No classified goals yet — run the Analyst first.");
      return;
    }
    setSaving(true);
    let success = 0;
    let failures = 0;
    const inputs = readInputs();
    for (const range of weeks) {
      try {
        synthesiseWeek({
          range,
          goals,
          specs,
          mrs: mrs || [],
          events: events || [],
          tickets,
          allInputs: inputs,
          capturedBy: "manual",
        });
        success += 1;
      } catch {
        failures += 1;
      }
    }
    setSaving(false);
    if (failures === 0) {
      toast.success(`Saved ${success} week${success === 1 ? "" : "s"}`);
    } else {
      toast.error(`Saved ${success}, ${failures} failed — check console`);
    }
  }, [weeks, goals, specs, mrs, events, tickets, hasSpecs]);

  if (!hasGoals) {
    return <EmptyState title="No goals to track yet" body="Add goals first." />;
  }
  if (!hasSpecs) {
    return (
      <EmptyState
        title="Goals not classified yet"
        body="Run the Analyst so each goal has a widget."
      />
    );
  }

  const gridTemplateColumns = `${LABEL_COL}px repeat(${weeks.length}, ${CELL_COL}px) ${ACTION_COL}px`;

  return (
    <div className="flex flex-col gap-3 px-6 py-4">
      <Toolbar
        fromLabel={fromLabel}
        toLabel={toLabel}
        weekCount={weeks.length}
        onPresetLastN={presetLastN}
        onShift={(dir) => shiftRange(weeks, dir, setRange)}
        onSaveAll={onSaveAll}
        saving={saving}
      />

      <div className="overflow-x-auto rounded-md border border-border">
        <div className="grid" style={{ gridTemplateColumns }}>
          {/* corner */}
          <div
            className="sticky left-0 top-0 z-20 border-b border-r border-border bg-bg px-3 py-2 text-[10px] uppercase tracking-[0.6px] text-muted-fg"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Goal
          </div>

          {/* week headers */}
          {weeks.map((wk) => (
            <div
              key={wk.weekLabel}
              className="sticky top-0 z-10 flex flex-col items-center justify-center border-b border-r border-border bg-bg/95 py-1 text-[11px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              <span className="font-semibold text-fg">{wk.weekLabel}</span>
              <span className="text-[10px] text-muted-fg">{shortRange(wk.start, wk.end)}</span>
            </div>
          ))}

          {/* trailing action column header */}
          <div
            className="sticky top-0 z-10 border-b border-border bg-bg/95 px-2 py-1 text-[10px] uppercase tracking-[0.6px] text-muted-fg"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Bulk
          </div>

          {/* rows, grouped by L1 */}
          {groupedItems.map((group) => (
            <GroupBlock
              key={group.l1.id}
              group={group}
              weekCount={weeks.length}
              weeks={weeks}
              mrsByWeek={mrsByWeek}
              eventsByWeek={eventsByWeek}
              ticketsCount={tickets.length}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── chrome ─────────────────────── */

function GroupBlock({ group, weekCount, weeks, mrsByWeek, eventsByWeek, ticketsCount }) {
  const totalCols = 1 + weekCount + 1;
  return (
    <>
      {/* L1 header banner spans the whole row */}
      <div
        className="sticky left-0 z-10 col-span-full border-b border-border bg-accent-dim/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.6px] text-fg"
        style={{ fontFamily: "var(--font-mono)", gridColumn: `1 / span ${totalCols}` }}
      >
        {group.l1.title}
        {group.l1.weightage != null && (
          <span className="ml-2 text-muted-fg/80">· weight {group.l1.weightage}%</span>
        )}
      </div>
      {group.items
        .filter((item) => item.goal.kind !== "L1")
        .map((item) => (
          <RowGroup
            key={item.goal.id}
            goal={item.goal}
            spec={item.spec}
            weeks={weeks}
            mrsByWeek={mrsByWeek}
            eventsByWeek={eventsByWeek}
            ticketsCount={ticketsCount}
          />
        ))}
    </>
  );
}

function RowGroup({ goal, spec, weeks, mrsByWeek, eventsByWeek, ticketsCount }) {
  return (
    <>
      <GridRow
        goal={goal}
        spec={spec}
        weeks={weeks}
        mrsByWeek={mrsByWeek}
        eventsByWeek={eventsByWeek}
        ticketsCount={ticketsCount}
      />
      <RowCopyButton goal={goal} spec={spec} weeks={weeks} />
    </>
  );
}

function Toolbar({
  fromLabel,
  toLabel,
  weekCount,
  onPresetLastN,
  onShift,
  onSaveAll,
  saving,
}) {
  return (
    <div className="sticky top-[64px] z-30 -mx-6 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-bg/85 px-6 py-2 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-[14px] font-semibold text-fg">Catch-up grid</h1>
          <p
            className="text-[10px] uppercase tracking-[0.6px] text-muted-fg"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {fromLabel} → {toLabel} · {weekCount} week{weekCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <NavBtn onClick={() => onShift(-1)} ariaLabel="Shift range earlier">
          <ChevronLeft size={14} />
        </NavBtn>
        <NavBtn onClick={() => onShift(+1)} ariaLabel="Shift range later">
          <ChevronRight size={14} />
        </NavBtn>
        <Preset onClick={() => onPresetLastN(4)}>4w</Preset>
        <Preset onClick={() => onPresetLastN(8)}>8w</Preset>
        <Preset onClick={() => onPresetLastN(12)}>12w</Preset>
        <button
          type="button"
          onClick={onSaveAll}
          disabled={saving}
          className="ml-2 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] uppercase tracking-[0.5px] text-accent-on transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <Save size={13} />
          {saving ? "Saving…" : "Save all"}
        </button>
      </div>
    </div>
  );
}

function NavBtn({ onClick, ariaLabel, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-fg hover:bg-accent-dim/60 hover:text-fg"
    >
      {children}
    </button>
  );
}

function Preset({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-[0.5px] text-muted-fg hover:bg-accent-dim/60 hover:text-fg"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {children}
    </button>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <h2 className="text-[14px] font-semibold text-fg">{title}</h2>
      <p className="max-w-md text-[12px] text-muted-fg">{body}</p>
    </div>
  );
}

/* ─────────────────────── helpers ─────────────────────── */

function bucketByWeek(items, weeks, dateAccessor) {
  const out = new Map();
  if (!Array.isArray(items)) return out;
  // Index weeks for fast lookup
  const byLabel = new Map(weeks.map((w) => [w.weekLabel, []]));
  for (const item of items) {
    const dt = dateAccessor(item);
    if (!dt) continue;
    const t = new Date(dt).getTime();
    for (const w of weeks) {
      if (t >= w.start.getTime() && t < w.end.getTime()) {
        byLabel.get(w.weekLabel).push(item);
        break;
      }
    }
  }
  return byLabel;
}

function shortRange(start, end) {
  const opts = { month: "short", day: "numeric" };
  const startFmt = start.toLocaleDateString("en-US", opts);
  // end is exclusive Friday 00:00 — display inclusive Thursday
  const inclusiveEnd = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const endFmt = inclusiveEnd.toLocaleDateString("en-US", opts);
  return `${startFmt}–${endFmt}`;
}

function shiftRange(weeks, dir, setRange) {
  if (weeks.length === 0) return;
  const span = weeks.length;
  const fromMs = weeks[0].start.getTime();
  const offsetDays = dir * span * 7;
  // Compute new from / to by shifting both edges by `span` weeks.
  const newFromSunday = new Date(fromMs + offsetDays * 24 * 60 * 60 * 1000);
  const newToSunday = new Date(
    newFromSunday.getTime() + (span - 1) * 7 * 24 * 60 * 60 * 1000,
  );
  setRange({
    from: weekLabelOf(newFromSunday),
    to: weekLabelOf(newToSunday),
  });
}

function weekLabelOf(sunday) {
  const midWeek = new Date(sunday.getTime() + 3 * 24 * 60 * 60 * 1000);
  const yearStart = new Date(midWeek.getFullYear(), 0, 1);
  const dayOfYear =
    Math.floor((midWeek - yearStart) / (24 * 60 * 60 * 1000)) + 1;
  const jan1Weekday = yearStart.getDay();
  const week = Math.ceil((dayOfYear + jan1Weekday) / 7);
  return `W${String(week).padStart(2, "0")}`;
}
