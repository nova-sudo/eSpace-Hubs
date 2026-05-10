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
      className="group relative inline-flex items-center gap-2 rounded-full border-0 px-3.5 py-1.5 transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(56,38,255,0.28)]"
      style={{
        background: "var(--accent)",
        color: "var(--accent-on)",
      }}
    >
      <span
        aria-hidden="true"
        className="grid h-5 w-5 place-items-center rounded-full"
        style={{ background: "rgba(255,255,255,0.22)" }}
      >
        <SparkleGlyph />
      </span>
      <span
        className="font-bold uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.6px",
        }}
      >
        {label}
      </span>
      {dot}
    </button>
  );
}

function SparkleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2z"
        fill="currentColor"
      />
    </svg>
  );
}
