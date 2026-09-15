"use client";

/**
 * A goal's cadence windows as a strip of cells.
 *
 * The shared `<FillStrip>` primitive draws the same four states, but it can't
 * carry the one extra decoration this page needs: a tier-colored underline
 * per cell, so a filled window also says what it was graded. Same state →
 * token mapping as FillStrip, plus that line.
 */

import { tierColor, windowTier } from "./flow-row-meta";

const CELL_BG = {
  filled: "var(--ink)",
  owed: "var(--peach-ink)",
  current: "var(--card-alt)",
  future: "var(--card-alt)",
  settled: "var(--card-alt)",
};
const CELL_OPACITY = { owed: 0.55, settled: 0.6 };

// Capped so a weekly goal's 52 windows don't turn the strip into a hairline
// comb. The count beside it always states the true total.
export const MAX_CELLS = 24;

/** "Week 37" → "37", "September" → "Sep" — the strip has room for a hint. */
function shortLabel(label) {
  const s = String(label || "");
  const num = s.match(/(\d+)\s*$/);
  if (num) return num[1];
  return s.slice(0, 3);
}

export function WindowStrip({ goalId, cyc, showLabels = false, height = 15 }) {
  if (!cyc) return null;
  const windows = (cyc.windows || []).slice(-MAX_CELLS);
  if (windows.length === 0) return null;
  return (
    <div
      className="flex min-w-0 items-end gap-[3px]"
      title={`${cyc.filledCount}/${cyc.total} windows logged`}
    >
      {windows.map((w) => {
        const color = tierColor(windowTier(goalId, w.key));
        return (
          <span key={w.key} className="flex min-w-0 flex-1 flex-col items-center gap-[3px]">
            <span
              title={`${w.label} · ${w.state}`}
              className="w-full rounded-[var(--radius-md)]"
              style={{
                height,
                background: CELL_BG[w.state] || CELL_BG.future,
                opacity: CELL_OPACITY[w.state] ?? 1,
                border: w.state === "current" ? "1.5px dashed var(--dim-fg)" : undefined,
                borderBottom: color ? `2px solid ${color}` : undefined,
                boxSizing: "border-box",
              }}
            />
            {showLabels ? (
              <span className="w-full truncate text-center text-[11px] leading-none text-dim-fg">
                {shortLabel(w.label)}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
