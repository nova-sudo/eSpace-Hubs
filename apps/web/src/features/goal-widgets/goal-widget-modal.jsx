"use client";

/**
 * <GoalWidgetModal /> — a centered overlay that hosts the full <GoalWidget> for
 * one goal, so a surface that only shows a summary (the Intelligence carousel)
 * can let the user FILL or SET UP a goal in place instead of navigating to
 * Goals. GoalWidget does the routing: a context-required goal shows the
 * ContextCollector (setup questions); a tracked goal shows the widget body +
 * the cadence stepper (fill / backfill missing periods).
 *
 * Backdrop click + ESC close. Body click stops propagation so the widget's own
 * controls keep working. Mirrors ScorecardComponentModal's shell.
 */

import { useEffect } from "react";
import { GoalWidget } from "./goal-widget";

export function GoalWidgetModal({ open, onClose, spec, goal }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !spec) return null;

  const title = goal?.title || spec.title || "Goal";

  // Contained dialog, mirroring how the widget renders in the grid: the card
  // is capped at 88vh and the <GoalWidget> renders at its NATURAL height
  // inside a plain (block) scroll body — the body scrolls the whole widget,
  // exactly like the grid page scrolls a tall tile. We must NOT give the
  // widget a bounded height (e.g. flex-1): the composed widget's internal
  // `h-full` + fields-scroll then activate and collapse the cadence stepper /
  // tier ladder / footer on top of each other. The header is `shrink-0` and
  // lives OUTSIDE the scroll body, so it's always pinned at the top; the 88vh
  // cap (< viewport) keeps the whole dialog on-screen.
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — fill`}
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{ background: "rgba(10,10,20,0.55)", backdropFilter: "blur(2px)" }}
    >
      <div
        className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--radius-tile)]"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: "88vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 72px rgba(0,0,0,0.35)",
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--border)" }}
        >
          <span
            className="min-w-0 truncate font-semibold text-fg"
            style={{ fontFamily: "var(--font-display)", fontSize: 16, letterSpacing: "-0.3px" }}
            title={title}
          >
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-[var(--radius-sub)] px-2.5 py-1 text-muted-fg transition-colors hover:text-fg"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.5px",
              background: "transparent",
              border: "1px solid var(--border-strong)",
            }}
          >
            ✕ ESC
          </button>
        </div>
        {/* Plain block scroll body — the widget renders at natural height and
            THIS scrolls it. No flex bounding on the widget (see note above). */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <GoalWidget spec={spec} goal={goal} variant="dark" onRetry={null} />
        </div>
      </div>
    </div>
  );
}
