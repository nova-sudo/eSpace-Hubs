"use client";

import { useAnalyst, ANALYST_MODES } from "./analyst-provider";
import { useGoalSpecs } from "@/features/goal-specs";
import { useGoals } from "@/features/goals";

/**
 * Header pill that opens the analyst page. Inverse theme.
 *
 * Badge states:
 *   - no goals yet            → muted dot, "analyze goals"
 *   - goals but no specs      → amber dot, "analyze my goals"
 *   - goals ≤ specs (all done) → green dot, "goals analyzed"
 */
export function AnalystActivator() {
  const { requestOpen } = useAnalyst();
  const { goals, total } = useGoals();
  const { count } = useGoalSpecs();

  const totalGoals = (total?.l1s || 0) + (total?.l2s || 0);
  const hasGoals = totalGoals > 0;
  const allClassified = hasGoals && count >= totalGoals;
  const partial = hasGoals && count > 0 && count < totalGoals;

  let label = "Analyze goals";
  let dot = null;
  if (!hasGoals) {
    label = "AI Analyst";
    dot = null;
  } else if (allClassified) {
    label = "Goals analyzed";
    dot = (
      <span
        aria-hidden="true"
        className="block h-1.5 w-1.5 rounded-full"
        style={{
          background: "var(--accent-2)",
          boxShadow: "0 0 0 3px rgba(0,196,138,0.25)",
        }}
      />
    );
  } else if (partial) {
    label = "Resume analysis";
    dot = (
      <span
        aria-hidden="true"
        className="block h-1.5 w-1.5 rounded-full"
        style={{ background: "#f59e0b", boxShadow: "0 0 0 3px rgba(245,158,11,0.28)" }}
      />
    );
  } else {
    label = "Analyze my goals";
  }

  return (
    <button
      type="button"
      onClick={() =>
        requestOpen(
          allClassified ? ANALYST_MODES.WIDGETS : ANALYST_MODES.ANALYSIS,
        )
      }
      aria-label="Open AI Analyst"
      className="group relative inline-flex items-center gap-2.5 rounded-[var(--radius-sub)] border-0 px-3.5 py-2 transition-[transform,filter] hover:-translate-y-px hover:brightness-110"
      style={{
        background: "var(--accent)",
        color: "var(--accent-on)",
      }}
    >
      <DotGlyph />
      <span
        className="font-bold uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.8px",
        }}
      >
        {label}
      </span>
      {dot}
    </button>
  );
}

/** 2×2 dot-matrix glyph — the Nothing mark, on the accent button. */
function DotGlyph() {
  const on = { background: "var(--accent-on)", borderRadius: "50%" };
  const off = { background: "rgba(255,255,255,0.45)", borderRadius: "50%" };
  return (
    <span
      aria-hidden="true"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gridTemplateRows: "repeat(2, 1fr)",
        gap: 2,
        width: 12,
        height: 12,
      }}
    >
      <i style={on} />
      <i style={off} />
      <i style={off} />
      <i style={on} />
    </span>
  );
}
