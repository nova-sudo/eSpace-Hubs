"use client";

/**
 * Weekly check-in page.
 *
 * One page, one verb: "fill in this week's data, then save". The view
 * is addressable per-week via `?week=W19` (or `?week=W19-2026`) so
 * deep links and back-button navigation work, and devs catching up
 * after a vacation can step through each missing week from one tab.
 *
 * Layout:
 *   - Sticky header  → page title, week navigator, save button
 *   - Gap banner     → "you have N unfilled weeks before this one"
 *   - Grouped rows   → one section per L1, rows per classified L2
 *
 * The save button doesn't write anything itself — every editor writes
 * to `goal-inputs` on input. Save just re-runs the snapshot synthesise
 * for the active week so the snapshot stream reflects what was just
 * filled, and emits a toast confirming the capture.
 */

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Save, AlertTriangle, ArrowRight, LayoutGrid } from "lucide-react";
import { useGoals } from "@/features/goals";
import { useGoalSpecs, SPEC_KIND_META, SPEC_VARIANTS } from "@/features/goal-specs";
import { useGoalWidgetItems } from "@/features/goal-widgets";
import {
  useCombinedEventsSince,
  useCombinedMergedSince,
  useJiraTickets,
} from "@/features/integrations";
import { readInputs, readGoalEntries, useAllGoalInputs } from "@/features/goal-inputs";
import {
  readSnapshots,
  synthesiseWeek,
} from "@/features/snapshots";
import { isoDaysAgo } from "@/lib/date";
import { cn } from "@/lib/cn";
import { useCheckinWeek } from "./use-checkin-week";
import { WeekNavigator } from "./week-navigator";
import { GoalRow } from "./goal-row";

export function CheckinPage() {
  const {
    activeLabel,
    range,
    prevLabel,
    nextLabel,
    todayLabel,
    canGoNext,
    setWeekLabel,
  } = useCheckinWeek();

  const { goals } = useGoals();
  const { specs } = useGoalSpecs();
  const { groupedItems, hasGoals, hasSpecs } = useGoalWidgetItems();

  // Pull a full year's worth of merges + ~90d of events so backfilling
  // older weeks still has data to work with. SWR keys are stable per
  // day, so opening the page on the same day reuses the cache.
  const { data: mrs } = useCombinedMergedSince(isoDaysAgo(365));
  const { data: events } = useCombinedEventsSince(isoDaysAgo(90));
  const { data: jira } = useJiraTickets();
  const tickets = Array.isArray(jira?.issues) ? jira.issues : [];

  // Count completed weeks BEFORE the active one that have no snapshot.
  // Drives the gap banner. Cheap — both inputs change rarely.
  const gapCount = useUnfilledWeeksBefore(activeLabel);

  // "How done is this week?" — manual goals with an entry inside the active
  // week window, over all manual goals. Auto goals are excluded (nothing to
  // hand-fill). Subscribes to the inputs store so it climbs live as the
  // user fills rows.
  const inputsTick = useAllGoalInputs();
  const completion = useMemo(() => {
    const s = range.start.getTime();
    const e = range.end.getTime();
    let total = 0;
    let filled = 0;
    for (const group of groupedItems) {
      for (const item of group.items) {
        if (item.goal.kind === "L1") continue;
        if (SPEC_KIND_META[item.spec.widget]?.variant === SPEC_VARIANTS.AUTO) {
          continue; // auto-tracked — no manual entry expected
        }
        total += 1;
        const hit = readGoalEntries(item.goal.id).some(
          (en) => en.ts >= s && en.ts < e,
        );
        if (hit) filled += 1;
      }
    }
    return { total, filled };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedItems, range, inputsTick]);

  const params = useParams();
  const hubId = params?.hub || "dev";

  const onPrev = useCallback(() => setWeekLabel(prevLabel), [setWeekLabel, prevLabel]);
  const onNext = useCallback(() => setWeekLabel(nextLabel), [setWeekLabel, nextLabel]);
  const onToday = useCallback(() => setWeekLabel(todayLabel), [setWeekLabel, todayLabel]);

  const onSave = useCallback(() => {
    if (!hasSpecs) {
      toast.info("No classified goals yet — run the Analyst first.");
      return;
    }
    try {
      synthesiseWeek({
        range,
        goals,
        specs,
        mrs: mrs || [],
        events: events || [],
        tickets,
        allInputs: readInputs(),
        // The user is filling this in by hand; record the capture as
        // manual so it wins over any subsequent auto-snapshot for the
        // same week.
        capturedBy: "manual",
      });
      toast.success(`Saved week ${activeLabel}`);
    } catch (err) {
      toast.error(
        `Couldn't save week — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }, [
    activeLabel,
    range,
    goals,
    specs,
    mrs,
    events,
    tickets,
    hasSpecs,
  ]);

  // Empty-state branches
  if (!hasGoals) {
    return (
      <EmptyState
        title="No goals to track yet"
        body="Add goals on the Goals page, then come back to log this week's data."
      />
    );
  }
  if (!hasSpecs) {
    return (
      <EmptyState
        title="Goals not classified yet"
        body="Run the Analyst (chat panel) so each goal gets a widget. The check-in form needs widgets to know what to ask for."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      {/* Sticky header */}
      <div className="sticky top-[64px] z-10 -mx-6 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg/85 px-6 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-[15px] font-semibold text-fg">Weekly check-in</h1>
            <p
              className="text-[10px] uppercase tracking-[0.6px] text-muted-fg"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              fill in what you did · save to lock the week
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <WeekNavigator
            activeLabel={activeLabel}
            rangeStart={range.start}
            rangeEnd={range.end}
            todayLabel={todayLabel}
            canGoNext={canGoNext}
            onPrev={onPrev}
            onNext={onNext}
            onToday={onToday}
          />
          <Link
            href={`/${hubId}/checkin/grid`}
            className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[11px] uppercase tracking-[0.5px] text-muted-fg hover:bg-accent-dim/60 hover:text-fg"
            style={{ fontFamily: "var(--font-mono)" }}
            title="Multi-week catch-up grid"
          >
            <LayoutGrid size={13} />
            Grid
          </Link>
          <button
            type="button"
            onClick={onSave}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] uppercase tracking-[0.5px] text-accent-on hover:opacity-90"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <Save size={13} />
            Save week
          </button>
        </div>
      </div>

      <CompletionBar filled={completion.filled} total={completion.total} label={activeLabel} />

      {gapCount > 0 && (
        <GapBanner count={gapCount} hubId={hubId} />
      )}

      <div className="flex flex-col gap-5">
        {groupedItems.map((group) => (
          <L1Group key={group.l1.id} group={group}>
            {group.items
              // L1 entries already excluded by useGoalWidgetItems via
              // unclassifiedGoals logic, BUT the grouped result still
              // emits the L1 row first if classified. Drop kind:"L1"
              // here — check-in is L2-only.
              .filter((item) => item.goal.kind !== "L1")
              .map((item) => (
                <GoalRow
                  key={item.goal.id}
                  goal={item.goal}
                  spec={item.spec}
                  weekStart={range.start}
                  weekEnd={range.end}
                  activeLabel={activeLabel}
                  mrs={mrs}
                  events={events}
                  tickets={tickets}
                />
              ))}
          </L1Group>
        ))}
      </div>

      <div className="flex justify-end pt-4">
        <button
          type="button"
          onClick={onSave}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[11px] uppercase tracking-[0.5px] text-accent-on hover:opacity-90"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <Save size={13} />
          Save week
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────── chrome ─────────────────────── */

function L1Group({ group, children }) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between gap-2 border-b border-border/40 pb-1.5">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.6px] text-fg" style={{ fontFamily: "var(--font-mono)" }}>
          {group.l1.title}
        </h2>
        {group.l1.weightage != null && (
          <span className="text-[10px] text-muted-fg/70" style={{ fontFamily: "var(--font-mono)" }}>
            weight {group.l1.weightage}%
          </span>
        )}
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function CompletionBar({ filled, total, label }) {
  if (total === 0) return null; // all-auto week — nothing to hand-fill
  const pct = Math.round((filled / total) * 100);
  const done = filled >= total;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-bg px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-fg">
          {done ? `All caught up for ${label}` : `Logged this week`}
        </span>
        <span
          className="text-[10px] tabular-nums text-muted-fg"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {filled} / {total} goals
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(0,0,0,0.08)]">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${pct}%`,
            background: done ? "var(--good)" : "var(--accent)",
          }}
        />
      </div>
    </div>
  );
}

function GapBanner({ count, hubId }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
        "border-amber/40 bg-amber/5",
      )}
    >
      <div className="flex items-center gap-2 text-[12px] text-fg">
        <AlertTriangle size={14} className="text-amber" />
        <span>
          <strong>{count}</strong> unfilled week{count === 1 ? "" : "s"} before this one
        </span>
      </div>
      <Link
        href={`/${hubId}/checkin/grid`}
        className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2.5 py-1 text-[11px] uppercase tracking-[0.5px] text-fg hover:bg-accent-dim/60"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        Catch up {count} week{count === 1 ? "" : "s"}
        <ArrowRight size={12} />
      </Link>
    </div>
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

/**
 * How many completed Sun → Thu weeks before `activeLabel` (within the
 * current calendar year) don't have a snapshot yet? Used to drive the
 * gap banner.
 */
function useUnfilledWeeksBefore(activeLabel) {
  return useMemo(() => {
    if (typeof window === "undefined") return 0;
    const existing = new Set(readSnapshots().map((s) => s.week));

    // Enumerate completed weeks ending before activeLabel. We rely on
    // the "Wnn" label sorting correctly within a year, so any snapshot
    // week with label < activeLabel is BEFORE this week.
    const now = new Date();
    const year = now.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const thisSunday = new Date(now);
    thisSunday.setDate(now.getDate() - now.getDay());
    thisSunday.setHours(0, 0, 0, 0);

    const labels = [];
    const cursor = new Date(thisSunday);
    cursor.setDate(cursor.getDate() - 7); // start at most-recent completed
    while (cursor >= yearStart) {
      const midWeek = new Date(cursor);
      midWeek.setDate(cursor.getDate() + 3);
      const label = `W${String(weekNumberOf(midWeek)).padStart(2, "0")}`;
      if (label < activeLabel) labels.push(label);
      cursor.setDate(cursor.getDate() - 7);
    }
    return labels.filter((l) => !existing.has(l)).length;
  }, [activeLabel]);
}

function weekNumberOf(date) {
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor(
    (date - yearStart) / (24 * 60 * 60 * 1000),
  ) + 1;
  const jan1Weekday = yearStart.getDay();
  return Math.ceil((dayOfYear + jan1Weekday) / 7);
}
