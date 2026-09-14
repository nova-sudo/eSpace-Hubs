"use client";

import { Suspense } from "react";
import { Label, SegmentedControl } from "@/components/ui";
import { PRESETS, PRESET_IDS } from "./presets";
import { useDateRange } from "./use-date-range";

/**
 * Preset switcher. Sits between the attention band and the bento grid.
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
    <div className="relative z-[2] flex items-center gap-3 px-4 sm:px-10 pb-5">
      <Label>Range</Label>
      <div className="h-9 w-64 rounded-[var(--radius-pill)] bg-card-alt" />
    </div>
  );
}

function DateRangeToolbarInner() {
  const { preset, setPreset, range } = useDateRange();
  const options = PRESET_IDS.map((id) => ({ value: id, label: PRESETS[id].label }));

  return (
    <div className="relative z-[2] flex flex-wrap items-center justify-between gap-3 px-4 sm:px-10 pb-5">
      <div className="flex items-center gap-3">
        <Label>Range</Label>
        <SegmentedControl options={options} value={preset} onChange={setPreset} size="sm" />
      </div>
      <Label className="text-dim-fg">{fmtRange(range)}</Label>
    </div>
  );
}

function fmtRange(range) {
  const fmt = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(range.start)} — ${fmt(range.end)}  ·  vs.  ${fmt(range.prevStart)} — ${fmt(range.prevEnd)}`;
}
