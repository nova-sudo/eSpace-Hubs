"use client";

import { Suspense } from "react";
import { MonoLabel } from "@/components/ui";
import { cn } from "@/lib/cn";
import { PRESETS, PRESET_IDS } from "./presets";
import { useDateRange } from "./use-date-range";

/**
 * Pill-style preset switcher.
 * Sits between the attention band and the bento grid.
 *
 * Wrapped in Suspense because `useDateRange()` calls `useSearchParams()`, which
 * Next.js requires inside a Suspense boundary during static rendering.
 */
export function DateRangeToolbar() {
  return (
    <Suspense fallback={<ToolbarSkeleton />}>
      <DateRangeToolbarInner />
    </Suspense>
  );
}

function ToolbarSkeleton() {
  return (
    <div className="relative z-[2] flex items-center gap-3 px-10 pb-5">
      <MonoLabel>Range</MonoLabel>
      <div className="h-7 w-64 rounded-[var(--radius-sub)] bg-card-alt" />
    </div>
  );
}

function DateRangeToolbarInner() {
  const { preset, setPreset, range } = useDateRange();

  return (
    <div className="relative z-[2] flex flex-wrap items-center justify-between gap-3 px-10 pb-5">
      <div className="flex items-center gap-3">
        <MonoLabel>Range</MonoLabel>
        <div className="flex flex-wrap gap-1">
          {PRESET_IDS.map((id) => {
            const p = PRESETS[id];
            const active = preset === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPreset(id)}
                title={p.hint}
                className={cn(
                  "cursor-pointer rounded-[var(--radius-sub)] border px-3 py-1.5 uppercase tracking-[0.4px] transition-colors",
                  active
                    ? "border-accent bg-accent text-accent-on"
                    : "border-border bg-card text-fg hover:border-border-strong",
                )}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 600,
                }}
                aria-pressed={active}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        className="text-muted-fg"
        style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}
      >
        {fmtRange(range)}
      </div>
    </div>
  );
}

function fmtRange(range) {
  const fmt = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(range.start)} — ${fmt(range.end)}  ·  vs.  ${fmt(range.prevStart)} — ${fmt(range.prevEnd)}`;
}
