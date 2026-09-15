"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getGoalsView,
  getGoalsViewServerSnapshot,
  setGoalsView,
  subscribeGoalsView,
} from "./goals-view-store";

/**
 * `[view, setView]` over the persisted Goals-page view choice. Same shape as
 * `useState` so the page reads the same either way.
 */
export function useGoalsView() {
  const view = useSyncExternalStore(
    subscribeGoalsView,
    getGoalsView,
    getGoalsViewServerSnapshot,
  );
  const setView = useCallback((next) => setGoalsView(next), []);
  return [view, setView];
}
