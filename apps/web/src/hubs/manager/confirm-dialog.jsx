"use client";

/**
 * A small in-app confirmation, for the one destructive action in the
 * manager portal (removing a tier policy).
 *
 * `window.confirm` was doing this job: an OS chrome dialog in a system
 * font, unstyleable, unfocusable by the app, and silently suppressible
 * by the browser — a poor last gate in front of a write that changes how
 * every matching goal in the org is graded. Same overlay contract as the
 * grading drawer: portal, focus trap, Escape, backdrop click.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, useFocusTrap } from "@/components/ui";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Remove",
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onClose,
}) {
  const trapRef = useFocusTrap(open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-fg/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed left-1/2 top-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xl)] bg-card p-6"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <h2 className="text-[18px] font-bold tracking-[-0.01em] text-fg">{title}</h2>
        {body ? (
          <p className="mt-2 text-[13px] leading-[1.6] text-muted-fg">{body}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2.5">
          <Button type="button" variant="soft" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
