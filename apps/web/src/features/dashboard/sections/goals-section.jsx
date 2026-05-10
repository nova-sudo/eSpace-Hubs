"use client";

import { Section } from "../scroll-shell";
import {
  GoalsTile,
  SnapshotsTile,
  ExportTile,
  CommitsTile,
} from "../tiles";

/**
 * GOALS TAB · SECTION 01 — Performance goals & evidence
 *
 * Layout (5-row grid → 4:1 vertical ratio between goals and evidence row):
 *   sec-head: "01 · Performance goals & evidence"
 *   [GoalsTile 12×4]                 // tall — owns 80% of section height
 *   row: [Snapshots 4×1] [Export accent 4×1] [Commits 4×1]   // compact strip
 *
 * Renders inside the Goals tab (`/goals`) — used to be section 04 of a
 * single dashboard but the dashboard split into Performance + Goals tabs
 * so users get a focused view of each side.
 */
export function GoalsSection() {
  return (
    <Section
      id="sec-goals"
      number="01"
      title="Performance goals & evidence"
      subtitle="L1 → L2 · snapshots · export"
      railLabel="goals"
    >
      {/* Single 12-col grid with two rows worth of content: the Goals tile
          takes rows 1–2 across all 12 columns, and the three evidence tiles
          sit in rows 3–4. Using `minmax(0, 1fr)` lets all four rows share the
          remaining section height instead of enforcing a fixed 150px each,
          which would cause the section to exceed the viewport. */}
      <div
        className="grid min-h-0 flex-1 grid-cols-12 gap-3.5"
        style={{ gridAutoRows: "minmax(0, 1fr)" }}
      >
        <GoalsTile />
        <SnapshotsTile />
        <ExportTile />
        <CommitsTile />
      </div>
    </Section>
  );
}
