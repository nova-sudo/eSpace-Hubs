"use client";

/**
 * App-level state for the Analyst page. Replaces the old ChatProvider.
 *
 * Exposes:
 *   - open / setOpen / close / toggle  (controls the swipe-in overlay)
 *   - mode / setMode                   ("analysis" | "widgets" | "chat")
 *   - requestOpen(mode)                (opens + sets mode in one call)
 *
 * Kept as a React context because the activator in the header and the page
 * itself live as siblings under AppShell. Context avoids prop-drilling + a
 * store; the shape is tiny so re-renders are cheap.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AnalystContext = createContext(null);

export const ANALYST_MODES = Object.freeze({
  ANALYSIS: "analysis",
  REVIEW: "review",
  WIDGETS: "widgets",
  CHAT: "chat",
});

export function AnalystProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(ANALYST_MODES.WIDGETS);

  // Hide horizontal overflow so the slide-in doesn't expose a 200% scroll
  // area. Same trick as the old chat provider — scoped to html so sticky
  // headers keep working.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const prev = document.documentElement.style.overflowX;
    document.documentElement.style.overflowX = "hidden";
    return () => {
      document.documentElement.style.overflowX = prev;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const requestOpen = useCallback((nextMode) => {
    if (nextMode) setMode(nextMode);
    setOpen(true);
  }, []);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      close,
      toggle,
      mode,
      setMode,
      requestOpen,
    }),
    [open, mode, close, toggle, requestOpen],
  );

  return <AnalystContext.Provider value={value}>{children}</AnalystContext.Provider>;
}

export function useAnalyst() {
  const ctx = useContext(AnalystContext);
  if (!ctx) {
    throw new Error("useAnalyst must be used inside <AnalystProvider>");
  }
  return ctx;
}
