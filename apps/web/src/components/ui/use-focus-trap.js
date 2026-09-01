"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep keyboard focus inside a dialog while it's open (#239): moves focus
 * to the first focusable child on open and wraps Tab / Shift+Tab at the
 * edges. Escape handling and focus-restore stay with the caller — they
 * already exist in both dialogs and depend on caller state.
 *
 *   const trapRef = useFocusTrap(open);
 *   <div ref={trapRef} role="dialog" aria-modal="true">…</div>
 */
export function useFocusTrap(active) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return undefined;
    const focusables = () => Array.from(root.querySelectorAll(FOCUSABLE));
    if (!root.contains(document.activeElement)) focusables()[0]?.focus?.();
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [active]);
  return ref;
}
