"use client";

/**
 * Backfill banner — surfaces below the demo banner / above the page
 * content. Self-hides when there's nothing to backfill, expands into
 * a progress bar while a run is in flight.
 *
 * Mount this once at the AppShell level. The hook (`useBackfill`)
 * decides whether to surface anything via its `missingWeeks` count.
 */

import { useBackfill } from "./use-backfill";
import { useDemoMode } from "@/features/demo-mode";

export function BackfillBanner() {
  const { run, isRunning, progress, missingWeeks } = useBackfill();
  const demo = useDemoMode();

  // Demo mode supplies its own pre-populated snapshot stream covering
  // Jan → now, so there's nothing to backfill. The banner would just
  // be visual noise. Suppress.
  if (demo) return null;
  if (!isRunning && missingWeeks === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-10 py-1.5"
      style={{
        background: "var(--accent-dim)",
        color: "var(--accent)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="flex items-baseline gap-2.5">
        <span
          className="font-bold uppercase tracking-[0.6px]"
          style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}
        >
          Cycle history
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>
          {isRunning && progress
            ? `Building week ${progress.done} of ${progress.total}…`
            : `${missingWeeks} week${missingWeeks === 1 ? "" : "s"} missing — backfill to unlock year-to-date compliance`}
        </span>
      </div>
      <button
        type="button"
        onClick={() => run()}
        disabled={isRunning}
        className="cursor-pointer rounded-[var(--radius-sub)] px-2.5 py-1 transition-colors disabled:cursor-default disabled:opacity-60"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
          color: "var(--accent-on)",
          background: "var(--accent)",
          border: "1px solid var(--accent)",
        }}
      >
        {isRunning ? "Running…" : "Backfill →"}
      </button>
    </div>
  );
}
