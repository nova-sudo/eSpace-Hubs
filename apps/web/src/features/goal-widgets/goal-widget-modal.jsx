"use client";

/**
 * <GoalWidgetModal /> — a centered overlay that hosts the full <GoalWidget> for
 * one goal, so a surface that only shows a summary (the Intelligence carousel)
 * can let the user FILL or SET UP a goal in place instead of navigating to
 * Goals. GoalWidget does the routing: a context-required goal shows the
 * ContextCollector (setup questions); a tracked goal shows the widget body +
 * the cadence stepper (fill / backfill missing periods).
 *
 * Backdrop click + ESC + ✕ close — but never over a typed, unsaved entry
 * (review-ux-flows bug 3): the modal is a guard-only draft host, and asks
 * "Keep editing / Discard / Save & close" first. Body click stops
 * propagation so the widget's own controls keep working. Mirrors
 * ScorecardComponentModal's shell.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button, IconButton, useFocusTrap } from "@/components/ui";
import { DraftFlushProvider, useDraftRegistry } from "@/features/goal-editors";
import { GoalWidget } from "./goal-widget";

/**
 * Text the user TYPED (this session) into a field that is NOT a registered
 * draft — e.g. the journal widget's own "Log" box — and that still holds
 * it. Such text can't be flushed from here, only kept or discarded.
 * Skipped: registered editors (`data-draft-registered`, handled by the
 * registry) and fields inside a <form> (setup questions save on blur).
 */
function unregisteredText(typed) {
  for (const el of typed) {
    if (!el.isConnected || el.closest("form") || el.hasAttribute("data-draft-registered")) continue;
    if (el.value.trim()) return true;
  }
  return false;
}

function isTextField(el) {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && (el.type === "text" || el.type === "");
}

export function GoalWidgetModal({ open, onClose, spec, goal }) {
  const trapRef = useFocusTrap(open && !!spec);
  // Guard-only host: editors keep their own Log/Save buttons, but Esc / ✕ /
  // backdrop now see a typed draft instead of silently dropping it.
  const drafts = useDraftRegistry();
  const [confirming, setConfirming] = useState(null); // null | { canSave }
  // Fields the user typed into since the modal opened.
  const typed = useRef(new Set());

  useEffect(() => {
    if (!open) {
      setConfirming(null);
      typed.current = new Set();
    }
  }, [open]);

  const requestClose = useCallback(() => {
    const registered = drafts.anyDirty();
    const loose = unregisteredText(typed.current);
    if (!registered && !loose) {
      onClose?.();
      return;
    }
    setConfirming({ canSave: registered && !loose });
  }, [drafts, onClose]);

  const saveAndClose = useCallback(() => {
    const { ok, failed } = drafts.flushAll();
    if (!ok) {
      setConfirming(null);
      failed[0]?.focus?.();
      return;
    }
    setConfirming(null);
    onClose?.();
  }, [drafts, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    // #239: focus goes back to whoever opened us — useFocusTrap restores it.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // Esc on the confirm bar = keep editing; otherwise ask before closing.
      if (confirming) setConfirming(null);
      else requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, confirming, requestClose]);

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
      className="fixed inset-0 z-[120] flex items-center justify-center bg-scrim p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
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
          <IconButton label="Close" onCard onClick={requestClose}>
            <X size={16} />
          </IconButton>
        </div>
        {confirming ? (
          <div
            role="alertdialog"
            aria-label="Unsaved entry"
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-peach px-5 py-3"
          >
            <span className="text-[13px] font-semibold text-peach-text">
              {confirming.canSave
                ? "You have an entry you haven't saved."
                : "You have a note you haven't logged. Discard it?"}
            </span>
            <span className="flex items-center gap-2">
              <Button variant="soft" size="sm" onClick={() => setConfirming(null)} autoFocus>
                Keep editing
              </Button>
              <Button
                variant="soft"
                size="sm"
                onClick={() => {
                  setConfirming(null);
                  onClose?.();
                }}
              >
                Discard
              </Button>
              {confirming.canSave ? (
                <Button size="sm" onClick={saveAndClose}>
                  Save &amp; close
                </Button>
              ) : null}
            </span>
          </div>
        ) : null}
        {/* Plain block scroll body — the widget renders at natural height and
            THIS scrolls it. No flex bounding on the widget (see note above). */}
        <div
          className="min-h-0 flex-1 overflow-y-auto p-5"
          onInput={(e) => {
            if (isTextField(e.target)) typed.current.add(e.target);
          }}
        >
          <DraftFlushProvider registry={drafts} hosting={false}>
            <GoalWidget spec={spec} goal={goal} onRetry={null} />
          </DraftFlushProvider>
        </div>
      </div>
    </div>,
    document.body,
  );
}
