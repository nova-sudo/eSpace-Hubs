"use client";

/**
 * Single-line compliance summary used by every auto / cadence-window
 * goal widget. Reads from the snapshot stream via `useSnapshotCompliance`
 * and renders something like:
 *
 *   [97%] on target · 16 of 17 weeks at <=2 rounds · in progress: W18 (1.6)
 *
 * Three modes:
 *   - data available with closed windows  →  full line
 *   - only the in-progress window has data → "tracking · W18 (1.6 / target)"
 *   - no readings yet                      → muted "no history yet"
 */

import { Badge } from "@/components/ui";
import { useSnapshotCompliance } from "@/features/snapshots";
import { cadenceWindowLabel } from "@/features/goal-inputs";

export function ComplianceLine({ goalId }) {
  const compliance = useSnapshotCompliance(goalId);

  if (!compliance || compliance.windows.length === 0) {
    return (
      <div className="text-[12.5px] text-muted-fg">
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
      <div className="text-[12.5px] text-muted-fg">
        Tracking · {inProgress?.cadenceWindow || "current window"}
        {inProgress?.cumulative != null
          ? ` · ${formatNumber(inProgress.cumulative)}${formatTarget(inProgress.target)}`
          : ""}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-fg">
      <Badge tone={pct >= 80 ? "mint" : "peach"}>{pct}%</Badge>
      <span>
        on target · {metWindows} of {totalWindows} {noun}
      </span>
      {inProgress ? (
        <span>
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
