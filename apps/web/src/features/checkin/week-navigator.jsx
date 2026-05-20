"use client";

/**
 * Top-of-page week selector. Renders prev / current / next + a Today
 * button. Designed to be small enough to live in a sticky page header
 * alongside the "Save week" CTA.
 *
 * The hard rule: you can navigate as far back as Jan 1 of the current
 * year, but you can't step forward past `todayLabel` (the most recent
 * completed week). The in-progress week has no Thu EOD yet — there's
 * nothing for the user to fill that wouldn't be invalidated 4 days
 * later.
 */

import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";

export function WeekNavigator({
  activeLabel,
  rangeStart,
  rangeEnd,
  todayLabel,
  canGoNext,
  onPrev,
  onNext,
  onToday,
}) {
  const display = formatRange(rangeStart, rangeEnd);
  const atToday = activeLabel === todayLabel;

  return (
    <div className="flex items-center gap-1.5">
      <NavButton onClick={onPrev} ariaLabel="Previous week">
        <ChevronLeft size={16} />
      </NavButton>

      <div
        className="flex flex-col items-center justify-center rounded-md border border-border bg-bg px-3 py-1.5"
        style={{ minWidth: 168, fontFamily: "var(--font-mono)" }}
      >
        <div className="text-[11px] uppercase tracking-[0.6px] text-muted-fg">
          {activeLabel}
        </div>
        <div className="text-[12px] font-medium text-fg">{display}</div>
      </div>

      <NavButton onClick={onNext} disabled={!canGoNext} ariaLabel="Next week">
        <ChevronRight size={16} />
      </NavButton>

      <button
        type="button"
        onClick={onToday}
        disabled={atToday}
        className={cn(
          "ml-1 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] uppercase tracking-[0.4px] transition-colors",
          atToday
            ? "cursor-default text-muted-fg/50"
            : "text-muted-fg hover:bg-accent-dim/60 hover:text-fg",
        )}
        style={{ fontFamily: "var(--font-mono)" }}
        title="Jump to the most recent completed week"
      >
        <CalendarDays size={12} />
        Today
      </button>
    </div>
  );
}

function NavButton({ onClick, disabled, ariaLabel, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-md border border-border transition-colors",
        disabled
          ? "cursor-default text-muted-fg/40"
          : "text-muted-fg hover:bg-accent-dim/60 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/* ─────── helpers ─────── */

function formatRange(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return "—";
  const opts = { month: "short", day: "numeric" };
  const startFmt = start.toLocaleDateString("en-US", opts);
  // `end` is the EXCLUSIVE Friday 00:00. Display the inclusive
  // Thursday so users see the actual work-week (Sun → Thu).
  const inclusiveEnd = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const endFmt = inclusiveEnd.toLocaleDateString("en-US", opts);
  return `${startFmt} – ${endFmt}`;
}
