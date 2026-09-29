"use client";

/**
 * A goal's cadence windows as a strip of cells.
 *
 * The shared `<FillStrip>` primitive draws the same four states, but it can't
 * carry the one extra decoration this page needs: a tier-colored underline
 * per cell, so a filled window also says what it was graded. Same state →
 * token mapping as FillStrip, plus that line.
 *
 * Weekly cells are Sunday-anchored work weeks labelled like the snapshot
 * store's weeks. A "before" cell ended before the tracker was created: it is
 * drawn neutral and faded, never peach, and says so in its tooltip.
 */

import { windowCellTitle, loggedSoFar } from "@/features/goal-inputs";
import { tierColor, windowTier } from "./flow-row-meta";

const CELL_BG = {
  filled: "var(--ink)",
  owed: "var(--peach-text)",
  current: "var(--track)",
  future: "var(--track)",
  settled: "var(--track)",
  before: "var(--card-alt)",
};
const CELL_OPACITY = { settled: 0.6, before: 0.35 };

// Capped so a weekly goal's 52 windows don't turn the strip into a hairline
// comb. The count beside it always states the true total.
export const MAX_CELLS = 24;

/**
 * Per-side border longhands for a cell: a dashed outline when current, the
 * tier line on the bottom edge when graded. Every key is a longhand (no
 * `border` / `borderStyle` shorthands) so React never sees a shorthand and
 * a longhand for the same edge change between renders.
 */
function cellBorder(isCurrent, tierLine) {
  if (!isCurrent && !tierLine) return {};
  const out = {};
  for (const side of ["Top", "Right", "Bottom", "Left"]) {
    out[`border${side}Style`] = isCurrent ? "dashed" : "none";
    out[`border${side}Width`] = isCurrent ? "1.5px" : "0px";
    out[`border${side}Color`] = "var(--dim-fg)";
  }
  if (tierLine) {
    out.borderBottomStyle = "solid";
    out.borderBottomWidth = "2px";
    out.borderBottomColor = tierLine;
  }
  return out;
}

/** "W37" → "37", "Week 37" → "37", "September" → "Sep" — the strip has room for a hint. */
function shortLabel(label) {
  const s = String(label || "");
  const week = s.match(/^W(\d+)/);
  if (week) return week[1];
  const num = s.match(/(\d+)\s*$/);
  if (num) return num[1];
  return s.slice(0, 3);
}

/**
 * The MAX_CELLS-wide slice CENTRED on the current window — `slice(-24)` showed
 * October through next September for a 52-week goal in week 39, which is
 * mostly the future and hides the missed windows behind you.
 */
function visibleSlice(windows, currentIndex) {
  if (windows.length <= MAX_CELLS) return windows;
  const cur = currentIndex >= 0 ? currentIndex : windows.length - 1;
  let start = cur - Math.floor(MAX_CELLS / 2);
  start = Math.max(0, Math.min(start, windows.length - MAX_CELLS));
  return windows.slice(start, start + MAX_CELLS);
}

export function WindowStrip({ goalId, cyc, showLabels = false, height = 15 }) {
  if (!cyc) return null;
  const all = cyc.windows || [];
  const currentIndex = Number.isInteger(cyc.currentIndex)
    ? cyc.currentIndex
    : all.findIndex((w) => w.state === "current");
  const windows = visibleSlice(all, currentIndex);
  if (windows.length === 0) return null;
  const currentKey = currentIndex >= 0 ? all[currentIndex]?.key : null;
  return (
    <div
      className="flex min-w-0 items-end gap-[3px]"
      title={
        (() => {
          const l = loggedSoFar(cyc);
          return l && l.due > 0 ? `${l.done} of ${l.due} windows due so far are logged` : "Nothing due yet";
        })() +
        (cyc.beforeCount > 0 ? ` · ${cyc.beforeCount} earlier ${cyc.beforeCount === 1 ? "window" : "windows"} before this tracker existed` : "")
      }
    >
      {windows.map((w) => {
        const color = tierColor(windowTier(goalId, w.key));
        const isCurrent = w.key === currentKey;
        return (
          <span key={w.key} className="flex min-w-0 flex-1 flex-col items-center gap-[3px]">
            <span
              title={windowCellTitle(w, w.state, isCurrent)}
              className="w-full rounded-[var(--radius-md)]"
              style={{
                height,
                background: CELL_BG[w.state] || CELL_BG.future,
                opacity: CELL_OPACITY[w.state] ?? 1,
                // The current window is always outlined, filled or not; a
                // graded window carries its tier color on the bottom edge.
                // Longhands only — mixing the `border` shorthand with
                // `borderBottom` makes React warn when either one changes.
                ...cellBorder(isCurrent, color),
                boxSizing: "border-box",
              }}
            />
            {showLabels ? (
              <span className="w-full truncate text-center text-[11px] leading-none text-muted-fg">
                {shortLabel(w.label)}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
