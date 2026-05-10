"use client";

/**
 * Single-line compliance summary used by every auto / cadence-window
 * goal widget. Reads from the snapshot stream via `useSnapshotCompliance`
 * and renders something like:
 *
 *   97% on target · 16 of 17 weeks at <=2 rounds · in progress: W18 (1.6)
 *
 * Three modes:
 *   - data available with closed windows  →  full line
 *   - only the in-progress window has data → "tracking · W18 (1.6 / target)"
 *   - no readings yet                      → muted "no history yet"
 */

import { useSnapshotCompliance } from "@/features/snapshots";
import { cadenceWindowLabel } from "@/features/goal-inputs";

export function ComplianceLine({ goalId, variant = "light" }) {
  const compliance = useSnapshotCompliance(goalId);

  const muted =
    variant === "light" ? "rgba(255,255,255,0.72)" : "var(--muted-fg)";
  const accent =
    variant === "light" ? "#ffffff" : "var(--accent)";

  if (!compliance || compliance.windows.length === 0) {
    return (
      <div
        className="uppercase tracking-[0.4px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: muted,
        }}
      >
        No history yet — first weekly capture lands Thursday EOD
      </div>
    );
  }

  const { pct, metWindows, totalWindows, cadence, inProgress } = compliance;
  const [singular, plural] = cadenceWindowLabel(cadence || "weekly");
  const noun = totalWindows === 1 ? singular : plural;

  if (pct == null) {
    // No closed windows yet — just an in-progress one.
    return (
      <div
        className="uppercase tracking-[0.4px]"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: muted,
        }}
      >
        Tracking · {inProgress?.cadenceWindow || "current window"}
        {inProgress?.cumulative != null
          ? ` · ${formatNumber(inProgress.cumulative)}${formatTarget(inProgress.target)}`
          : ""}
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-baseline gap-2"
      style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: muted }}
    >
      <span className="font-bold uppercase" style={{ color: accent }}>
        {pct}%
      </span>
      <span className="uppercase tracking-[0.4px]">
        on target · {metWindows} of {totalWindows} {noun}
      </span>
      {inProgress ? (
        <span className="uppercase tracking-[0.4px]">
          · in progress {inProgress.cadenceWindow}
          {inProgress.cumulative != null
            ? ` (${formatNumber(inProgress.cumulative)}${formatTarget(inProgress.target)})`
            : ""}
        </span>
      ) : null}
    </div>
  );
}

function formatNumber(n) {
  if (n == null) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function formatTarget(target) {
  if (!target || target.value == null) return "";
  return ` ${target.op} ${target.value}`;
}
