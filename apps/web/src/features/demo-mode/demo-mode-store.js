"use client";

/**
 * Demo-mode toggle, backed by localStorage.
 *
 * When ON:
 *   - integration hooks short-circuit to synthetic data (see `demo-dataset.js`)
 *   - useIntegrations reports github + gitlab + jira as "connected"
 *   - a banner renders at the top of the app so it's never confusing
 *
 * When OFF (default): everything behaves exactly as before.
 *
 * Keep this primitive — it's a single boolean. We use a real localStorage
 * key so the choice survives reloads, and a dedicated change event so
 * components can re-render without polling.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "espace-devhub:demo-mode";
const CHANGE_EVENT = "demo-mode:change";

export const DEMO_MODE_CHANGE_EVENT = CHANGE_EVENT;

export function readDemoMode() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDemoMode(on) {
  if (typeof window === "undefined") return;
  if (on) localStorage.setItem(STORAGE_KEY, "1");
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/**
 * React binding. Returns a stable boolean that flips when setDemoMode is
 * called from anywhere in the app. The server snapshot is `false` to
 * avoid hydration mismatches — demo mode is purely a client-side concern.
 */
export function useDemoMode() {
  return useSyncExternalStore(
    subscribe,
    () => readDemoMode(),
    () => false,
  );
}
