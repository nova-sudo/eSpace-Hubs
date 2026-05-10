"use client";

/**
 * <GoalWidgetsGrid /> — height-aware masonry for the goal widgets.
 *
 * Why not CSS Grid + minmax?
 *   Fixed rows force every widget in the same row to stretch to the
 *   tallest cell, leaving big empty pads under short widgets when a
 *   tall CODE_RUBRIC sits next to them.
 *
 * Why not CSS columns + break-inside?
 *   Browsers auto-balance column heights, which means a tall widget
 *   in column 1 leaves the right-most column ending early — visible
 *   right-side empty space when the dataset is small (3-4 widgets per
 *   L1).
 *
 * What this does instead
 *   1. Estimate each widget's height with a kind-based weight (the
 *      CODE_RUBRIC list is ~4× the height of a single Counter stat).
 *   2. Distribute items into N columns greedily — each item slots into
 *      whichever column currently has the lowest cumulative weight.
 *   3. Render N flex-columns side-by-side. Each column packs items at
 *      their natural heights with no row-stretch.
 *
 * Result: the tall widget takes its full height, short widgets stack
 * tight beneath / beside it, and the available width is fully used.
 *
 * Responsive: we pick column count from viewport width (1/2/3/4 cols).
 * Server-render with 3 cols by default; `useEffect` updates on mount
 * for the precise width and listens for resize.
 */

import { useEffect, useMemo, useState } from "react";
import { GoalWidget } from "./goal-widget";

/**
 * Per-widget-kind height weights — relative units, not pixels. Tuned
 * by eyeballing the rendered widgets at 320px column width.
 */
const HEIGHT_WEIGHT = {
  // Tall: PR list with verdicts + diff hunks
  CODE_RUBRIC: 4.0,
  // Medium: list + actions
  MILESTONE: 1.8,
  DATE_LOG: 1.7,
  FREE_TEXT: 1.6,
  BEFORE_AFTER: 1.4,
  // Short: stat + bar
  COUNTER: 1.2,
  SCALE: 1.2,
  MERGED_COUNT: 1.0,
  REVIEW_ROUNDS: 1.1,
  TURNAROUND: 1.1,
  LINKAGE: 1.1,
  TICKET_CYCLE: 1.0,
};

/**
 * Pick a column count from viewport width. Tuned so each column is
 * comfortably wide (~360-440px) at every breakpoint.
 */
function colCountForWidth(w) {
  if (w < 720) return 1;
  if (w < 1080) return 2;
  if (w < 1500) return 3;
  return 4;
}

function useColCount() {
  // SSR-safe initial value — `null` flag tells the render path to use
  // the default 3-column layout until the client measures the actual
  // viewport width on mount. Avoids hydration mismatches.
  const [count, setCount] = useState(3);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setCount(colCountForWidth(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return count;
}

/**
 * Distribute items into N columns greedily — each item lands in the
 * column with the lowest cumulative weight at that moment. Order
 * within a column preserves item order. Slightly different from
 * "best-fit-decreasing" (which would sort by weight first) — keeping
 * source order matters because the L1 grouping above this means the
 * widgets are already sorted by importance.
 */
function distributeColumns(items, colCount) {
  const cols = Array.from({ length: colCount }, () => ({
    weight: 0,
    items: [],
  }));
  for (const it of items) {
    const w = HEIGHT_WEIGHT[it.spec?.widget] ?? 1.0;
    let target = cols[0];
    for (let i = 1; i < cols.length; i++) {
      if (cols[i].weight < target.weight) target = cols[i];
    }
    target.items.push(it);
    target.weight += w;
  }
  return cols.map((c) => c.items);
}

export function GoalWidgetsGrid({
  items,
  variant = "light",
  emptyState,
  className = "",
}) {
  const colCount = useColCount();
  const columns = useMemo(
    () => distributeColumns(items || [], colCount),
    [items, colCount],
  );

  if (!items || items.length === 0) {
    return emptyState ? <>{emptyState}</> : null;
  }

  return (
    <div
      className={`w-full ${className}`}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
        gap: 14,
        alignItems: "start",
      }}
    >
      {columns.map((col, i) => (
        <div
          key={i}
          // Each column is a flex stack — items pack at their natural
          // heights with no row-stretch from sibling columns.
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            minWidth: 0, // allow children to truncate without forcing column width
          }}
        >
          {col.map(({ goal, spec, onRetry }) => (
            <GoalWidget
              key={spec.goalId}
              goal={goal}
              spec={spec}
              variant={variant}
              onRetry={onRetry}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
