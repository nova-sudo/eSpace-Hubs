"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Active traps, innermost last. Only the top one handles Tab — a nested
 * dialog (portaled next to its parent) must not have the parent's trap
 * yank focus back to the parent on every keypress.
 */
const trapStack = [];

/** Focusable, visible, not inert — what Tab can actually land on. */
function focusablesIn(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) =>
      // `button[tabindex="-1"]` matches the selector but is deliberately
      // not a Tab stop (e.g. command-palette options, reached by arrows).
      el.tabIndex >= 0 &&
      !el.closest("[inert]") &&
      el.getAttribute("aria-hidden") !== "true" &&
      (el.offsetParent !== null || el.getClientRects().length > 0),
  );
}

/**
 * Keep keyboard focus inside a dialog while it's open (#239), and give it
 * back when the dialog closes.
 *
 *   - On activate: remembers the element that had focus (the opener), then
 *     moves focus to the first focusable child unless focus is already
 *     inside. The opener is captured HERE, before the trap moves focus — a
 *     caller capturing it in its own later effect saw the dialog's first
 *     button instead, and focus fell to <body> on close.
 *   - While active: EVERY Tab / Shift+Tab is handled here (next / previous
 *     item in the dialog's own list, wrapping at both ends), so an element
 *     the selector doesn't list — a scrollable listbox Chrome makes
 *     tabbable — can't hand focus to the page behind an aria-modal dialog.
 *     Focus found outside the root on Tab is pulled back in.
 *   - Nested traps: only the innermost active one handles Tab.
 *   - On deactivate (active → false, or unmount): focus returns to the
 *     opener if it is still in the DOM — but only when focus is still in
 *     the dialog or has fallen to <body>, so a dialog that closed BECAUSE
 *     something else took focus (a command opening another overlay) never
 *     steals it back. If the opener sits in a region that is still `inert`
 *     for a frame (the analyst overlay's shell), it retries next frame.
 *
 * Escape handling stays with the caller — it depends on caller state.
 *
 *   const trapRef = useFocusTrap(open);
 *   <div ref={trapRef} role="dialog" aria-modal="true">…</div>
 */
export function useFocusTrap(active) {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => focusablesIn(root);
    if (!root.contains(document.activeElement)) focusables()[0]?.focus?.();

    const token = {};
    trapStack.push(token);
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      if (trapStack[trapStack.length - 1] !== token) return;
      const list = focusables();
      e.preventDefault();
      if (list.length === 0) {
        root.focus?.();
        return;
      }
      const idx = list.indexOf(document.activeElement);
      let next;
      if (idx === -1) {
        // Focus is on something outside the list (the root itself, a
        // non-listed scroller) or outside the dialog: go to the edge.
        next = e.shiftKey ? list[list.length - 1] : list[0];
      } else {
        next = list[(idx + (e.shiftKey ? -1 : 1) + list.length) % list.length];
      }
      next.focus();
    };
    // Capture phase on the document: a Tab pressed while focus has already
    // escaped the root still reaches the trap.
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      const at = trapStack.indexOf(token);
      if (at !== -1) trapStack.splice(at, 1);
      restoreFocus(root, opener);
    };
  }, [active]);
  return ref;
}

function restoreFocus(root, opener) {
  if (!opener || opener === document.body) return;
  const shouldRestore = () => {
    const now = document.activeElement;
    return (
      opener.isConnected &&
      (!now || now === document.body || (root && root.contains(now)))
    );
  };
  if (!shouldRestore()) return;
  opener.focus?.({ preventScroll: true });
  if (document.activeElement === opener) return;
  // The opener may be inside a region that is `inert` until a transition
  // flips it back — try once more on the next frame.
  requestAnimationFrame(() => {
    if (shouldRestore()) opener.focus?.({ preventScroll: true });
  });
}
