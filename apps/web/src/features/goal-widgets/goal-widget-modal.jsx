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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — fill`}
      className="fixed inset-0 z-[120] flex items-center justify-center px-4 py-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{ background: "rgba(10,10,20,0.55)", backdropFilter: "blur(2px)" }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--radius-tile)]"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 72px rgba(0,0,0,0.35)",
        }}
      >
        <div
          className="flex items-center justify-between gap-3 border-b px-4 py-3"
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
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <GoalWidget spec={spec} goal={goal} variant="dark" onRetry={null} />
        </div>
      </div>
    </div>
  );
}
