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
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { IconButton, useFocusTrap } from "@/components/ui";
import { GoalWidget } from "./goal-widget";

export function GoalWidgetModal({ open, onClose, spec, goal }) {
  const trapRef = useFocusTrap(open && !!spec);
  useEffect(() => {
    if (!open) return undefined;
    // #239: remember who opened us and hand focus back on close, so a
    // keyboard user isn't dropped at the top of the document.
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open || !spec) return null;
  if (typeof document === "undefined") return null;

  const title = goal?.title || spec.title || "Goal";

  // PORTAL TO document.body — this is load-bearing, not cosmetic. The AppShell
  // wraps the page in a `transform`/`will-change:transform` div (for the analyst
  // swipe). A transformed ancestor becomes the containing block for
  // `position:fixed` descendants, so WITHOUT the portal `fixed inset-0` sizes to
  // that wrapper (e.g. 746px), NOT the viewport — while `88vh` stays
  // viewport-relative (782px) and overflows it, cutting the header off the top
  // and the footer off the bottom. Portaling out of the wrapper makes `fixed`
  // truly viewport-relative again.
  //
  // Contained dialog: the card is capped at 88vh and the <GoalWidget> renders at
  // its NATURAL height inside a plain (block) scroll body — the body scrolls the
  // whole widget, like the grid page scrolls a tall tile. We must NOT give the
  // widget a bounded height (e.g. flex-1): the composed widget's internal
  // `h-full` + fields-scroll then activate and collapse the cadence stepper /
  // tier ladder / footer on top of each other. The header is `shrink-0`, outside
  // the scroll body, so it stays pinned at the top.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — fill`}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-fg/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={trapRef}
        className="flex w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--radius-xl)] bg-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "88vh", boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
          <span className="min-w-0 truncate text-[18px] font-bold tracking-[-0.01em] text-fg" title={title}>
            {title}
          </span>
          <IconButton label="Close" onCard onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {/* Plain block scroll body — the widget renders at natural height and
            THIS scrolls it. No flex bounding on the widget (see note above). */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <GoalWidget spec={spec} goal={goal} onRetry={null} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
