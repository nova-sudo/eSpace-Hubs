"use client";

/**
 * Headline numbers + one stacked bar per period (how the team did on each
 * deadline). The bars use the tint status tokens and are always paired with
 * a legend and a printed count, so color is never the only signal; each
 * segment carries a hover title with its exact count.
 */

import { Label, Stat } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDay, pct } from "./progress-grid";

const SEGMENTS = [
  { key: "onTime", label: "On time", cls: "bg-mint-ink" },
  { key: "late", label: "Late", cls: "bg-peach" },
  { key: "missing", label: "Missing", cls: "bg-peach-ink" },
  { key: "open", label: "Open", cls: "bg-lemon" },
  { key: "upcoming", label: "Upcoming", cls: "bg-card-alt" },
];

export function ProgressSummary({ totals, windows }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Assignees" value={totals.assignees} />
        <Stat
          label="Submitted"
          value={pct(totals.completionRate)}
          sub={totals.due ? `${totals.onTime + totals.late} of ${totals.due} due periods` : "Nothing due yet"}
        />
        <Stat label="On time" value={pct(totals.onTimeRate)} sub={`${totals.onTime} on time · ${totals.late} late`} />
        <Stat label="Missing" value={totals.missing} sub={totals.open ? `${totals.open} open now` : null} />
      </div>

      {windows.length > 1 ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>By period</Label>
            <div className="flex flex-wrap items-center gap-3 text-[12px] font-semibold text-muted-fg">
              {SEGMENTS.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className={cn("inline-block h-3 w-3 rounded-full", s.cls)} />
                  {s.label}
                </span>
              ))}
            </div>
          </div>
          <ul className="flex flex-col gap-1.5">
            {windows.map((w) => {
              const total = SEGMENTS.reduce((n, s) => n + (w.counts[s.key] || 0), 0) || 1;
              const done = w.counts.onTime + w.counts.late;
              return (
                <li key={w.key ?? "once"} className="grid grid-cols-[88px_1fr_92px] items-center gap-3">
                  <span className="truncate text-[13px] font-semibold text-fg" title={`Due ${fmtDay(w.deadline)}`}>
                    {w.label}
                  </span>
                  <span className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[var(--radius-pill)]">
                    {SEGMENTS.map((s) =>
                      w.counts[s.key] ? (
                        <span
                          key={s.key}
                          title={`${w.label} · ${s.label}: ${w.counts[s.key]}`}
                          className={cn("h-full first:rounded-l-[4px] last:rounded-r-[4px]", s.cls)}
                          style={{ width: `${(w.counts[s.key] / total) * 100}%` }}
                        />
                      ) : null,
                    )}
                  </span>
                  <span className="text-right text-[12px] font-semibold tabular-nums text-muted-fg">
                    {done}/{total} in
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
