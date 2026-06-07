"use client";

import { Section } from "../scroll-shell";
import {
  ActivityTile,
  HeatmapTile,
  ReviewsTile,
  TurnaroundTile,
} from "../tiles";
import { Loading } from "@/components/ui";
import { useTrendReady } from "../use-section-ready";

/**
 * SECTION 04 — Trends & breakdowns
 *
 * Layout (2 grid rows; 12 cols):
 *
 *   row 1, cols 1-6:    Heatmap            (year-shape)
 *   row 1, cols 7-9:    Turnaround         (compact: median + dot strip)
 *   row 1, cols 10-12:  Reviews given      (per-target list)
 *   row 2, cols 1-12:   Activity line chart (full-width)
 *
 * Listing order is the auto-flow order — CSS Grid places each tile in
 * the next available cell that fits its col/row spans. Heatmap fills
 * (1,1)-(6,1); Turnaround takes (7,1)-(9,1); Reviews takes (10,1)-(12,1)
 * — that completes row 1. Activity, with col span 12, then claims the
 * entire row 2.
 *
 * Why this shape: each row-1 tile is a "summary" view (year-shape,
 * distribution snapshot, reviewer list). The wide row-2 chart is the
 * "drill-in" view — the only place a wide x-axis really helps.
 */
export function TrendSection() {
  const ready = useTrendReady();
  return (
    <Section
      id="sec-trend"
      number="04"
      title="Trends & breakdowns"
      subtitle="Signal over time"
      railLabel="trend"
    >
      {!ready ? (
        <Loading
          loader="helix"
          size="2xl"
          color="var(--accent)"
          label="Loading trends…"
        />
      ) : (
        <div
          className="grid min-h-0 flex-1 grid-cols-12 gap-3.5"
          style={{ gridAutoRows: "minmax(0, 1fr)" }}
        >
          <HeatmapTile />
          <TurnaroundTile />
          <ReviewsTile />
          <ActivityTile />
        </div>
      )}
    </Section>
  );
}
