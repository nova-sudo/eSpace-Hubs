"use client";

import { useSyncExternalStore } from "react";

const LS_KEY = "espace-devhub:dashboard-view";
const VALID = new Set(["presentation", "compact"]);
const EVENT = "dashboard-view:change";

function read() {
  if (typeof window === "undefined") return "presentation";
  try {
    const v = localStorage.getItem(LS_KEY);
    return VALID.has(v) ? v : "presentation";
  } catch {
    return "presentation";
  }
}

function subscribe(cb) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function setDashboardView(mode) {
  if (!VALID.has(mode)) return;
  try {
    localStorage.setItem(LS_KEY, mode);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* ignore */
  }
}

export function useDashboardView() {
  const mode = useSyncExternalStore(subscribe, read, () => "presentation");
  return { mode, setMode: setDashboardView };
}
