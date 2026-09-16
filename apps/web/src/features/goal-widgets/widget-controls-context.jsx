"use client";

import { createContext, useContext } from "react";

/**
 * Widget-level user-controls, injected by `<GoalWidget>` and consumed by
 * `<WidgetShell>`. Keeping this in a context (rather than prop-drilling
 * through every widget) means the 11 widget files stay ignorant of the
 * override surface — they just call `<WidgetShell>` as before, and the
 * shell renders any footer chips provided here.
 *
 * All fields are optional. A handler being `null` means "don't show that
 * chip". The shell falls back to its default footer when the provider
 * isn't wrapped.
 */
const WidgetControlsContext = createContext({
  onMarkDelegated: null,
  onEditContext: null,
  onEditSetup: null,
});

export function WidgetControlsProvider({ value, children }) {
  return (
    <WidgetControlsContext.Provider value={value}>
      {children}
    </WidgetControlsContext.Provider>
  );
}

export function useWidgetControls() {
  return useContext(WidgetControlsContext);
}
