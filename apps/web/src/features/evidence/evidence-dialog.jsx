"use client";

/**
 * Small modal used by the Evidence page — the submit confirmation and
 * the "last submitted packet" viewer. Same overlay contract as the rest
 * of the app's dialogs: portal, focus trap, Escape, backdrop click.
 */

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconButton, useFocusTrap } from "@/components/ui";
import { X } from "lucide-react";

export function EvidenceDialog({ open, title, onClose, children, wide = false }) {
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
      <div className="fixed inset-0 z-[70] bg-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={
          wide
            ? "fixed left-1/2 top-1/2 z-[71] flex max-h-[85vh] w-[min(820px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[var(--radius-xl)] bg-card p-6"
            : "fixed left-1/2 top-1/2 z-[71] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xl)] bg-card p-6"
        }
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[18px] font-bold tracking-[-0.01em] text-fg">{title}</h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}
