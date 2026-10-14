"use client";

import { motion } from "framer-motion";
import { Label } from "@/components/ui";

/** Shared column template so the strip and every goal track line up. */
export function trackColumns(n) {
  return { gridTemplateColumns: `repeat(${Math.max(n, 1)}, minmax(28px, 1fr))` };
}

/**
 * Sticky header of the journey: one label per window key plus a progress bar
 * driven by the journey container's scroll (`progress` is a motion value, or
 * null for the static full bar under reduced motion).
 */
export function WindowStrip({ windows, progress }) {
  return (
    <div className="sticky top-0 z-10 overflow-hidden rounded-[var(--radius-lg)] bg-card shadow-[var(--shadow-card)]">
      <div className="overflow-x-auto px-9 py-3">
        <Label caps>Windows</Label>
        <div className="mt-2 grid gap-1" style={trackColumns(windows.length)}>
          {windows.map((w) => (
            <span key={w.key} title={w.label} className="truncate text-center text-[11px] font-semibold text-muted-fg">
              {w.label}
            </span>
          ))}
        </div>
      </div>
      <motion.div
        aria-hidden="true"
        className="h-1 origin-left bg-ink"
        style={{ scaleX: progress ?? 1 }}
      />
    </div>
  );
}
