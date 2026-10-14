"use client";

import { motion } from "framer-motion";
import { Label } from "@/components/ui";

/** Leading label column, present in the strip and in every goal row. */
export const LABEL_COL = 160;
/** Card padding (20) + row padding (16): the strip insets by the same amount so columns align. */
export const TRACK_INSET = 36;
const CELL_MIN = 28;
const GAP = 4;

/** Shared column template: label column, then one column per window key. */
export function trackColumns(n) {
  return { gridTemplateColumns: `${LABEL_COL}px repeat(${Math.max(n, 1)}, minmax(${CELL_MIN}px, 1fr))` };
}

/** Min width of the shared scroll content, so the strip and rows scale together. */
export function journeyMinWidth(n) {
  const cols = Math.max(n, 1);
  return TRACK_INSET * 2 + LABEL_COL + cols * CELL_MIN + cols * GAP;
}

/**
 * Sticky header of the journey. It sits outside the horizontal scroller (so
 * vertical sticky works) and mirrors the scroller's scrollLeft through
 * `innerRef`, which the journey updates on scroll. `progress` is a motion
 * value, or null for the static full bar under reduced motion.
 */
export function WindowStrip({ windows, progress, innerRef }) {
  return (
    <div className="sticky top-0 z-10 overflow-hidden rounded-[var(--radius-lg)] bg-card shadow-[var(--shadow-card)]">
      <div ref={innerRef} className="py-3" style={{ minWidth: journeyMinWidth(windows.length), paddingInline: TRACK_INSET }}>
        <div className="grid items-end gap-1" style={trackColumns(windows.length)}>
          <Label caps>Windows</Label>
          {windows.map((w) => (
            <span key={w.key} title={w.label} className="truncate text-center text-[11px] font-semibold text-muted-fg">
              {w.label}
            </span>
          ))}
        </div>
      </div>
      <motion.div aria-hidden="true" className="h-1 origin-left bg-ink" style={{ scaleX: progress ?? 1 }} />
    </div>
  );
}
