"use client";

import { DateRangeToolbar } from "./date-range";
import { AttentionBand } from "./attention-band";
import { setDashboardView } from "./use-dashboard-view";
import { ReviewPrepChecklist } from "@/features/evidence";
import {
  GoalComplianceTile,
  MergedTile,
  RoundsTile,
  LinkageTile,
  TicketsTile,
  PRsTile,
  TurnaroundTile,
  ReviewsTile,
  SnapshotsTile,
} from "./tiles";

/**
 * Compact / daily-use dashboard.
 *
 * Replaces the scroll-snap presentation shell with a normal vertical-scroll
 * page. All tiles are the same components and hooks — only the layout
 * differs. Row heights are explicit so BentoTile's flex-1 children still
 * get a constrained height to fill.
 *
 * The companion presentation mode is toggled via useDashboardView().
 */
export function CompactDashboard() {
  return (
    <div
      style={{
        height: "calc(100vh - var(--header-height))",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          padding: "28px 40px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {/* Controls bar */}
        <div className="flex items-center justify-between">
          {/* DateRangeToolbar has built-in px-10 pb-5 padding; cancel it with
              negative margins so it aligns to this container's edges. */}
          <div className="-mx-10 -mb-5">
            <DateRangeToolbar />
          </div>
          <button
            onClick={() => setDashboardView("presentation")}
            className="rounded-[var(--radius-sub)] border border-border bg-card px-3 py-1.5 text-fg transition-colors hover:border-border-strong"
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.4px" }}
          >
            ⊞ Presentation mode
          </button>
        </div>

        {/* — Review prep — */}
        <ReviewPrepChecklist />

        {/* — 01 · Overview metrics — */}
        <CompactGroup label="01 / Overview">
          <div
            className="grid grid-cols-12 gap-3.5"
            style={{ gridAutoRows: "130px" }}
          >
            <GoalComplianceTile />
            <MergedTile />
            <RoundsTile />
            <LinkageTile />
          </div>
        </CompactGroup>

        {/* — 02 · On your plate — */}
        <CompactGroup label="02 / On your plate">
          {/* AttentionBand also has built-in px-10 pb-5; cancel it. */}
          <div className="-mx-10 -mb-5">
            <AttentionBand />
          </div>
          <div
            className="grid grid-cols-12 gap-3.5"
            style={{ gridAutoRows: "110px" }}
          >
            <TicketsTile />
            <PRsTile />
          </div>
        </CompactGroup>

        {/* — 03 · Trends & evidence — */}
        <CompactGroup label="03 / Trends & evidence">
          <div
            className="grid grid-cols-12 gap-3.5"
            style={{ gridAutoRows: "200px" }}
          >
            <TurnaroundTile />
            <ReviewsTile />
            <SnapshotsTile />
          </div>
        </CompactGroup>
      </div>
    </div>
  );
}

function CompactGroup({ label, children }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        className="flex items-center gap-3 border-b border-border pb-2"
      >
        <span
          className="text-accent"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 18,
            fontWeight: 500,
          }}
        >
          {label.split(" / ")[0]}
        </span>
        <span
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            letterSpacing: "-0.4px",
          }}
        >
          {label.split(" / ")[1]}
        </span>
      </div>
      {children}
    </section>
  );
}
