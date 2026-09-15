"use client";

/**
 * Which of the two member views the admin last used — "table" (the flat
 * list) or "detail" (list + side panel).
 *
 * Persisted to localStorage and broadcast on a change event so a second
 * tab, or a sibling hook in the same tab, re-renders instead of drifting
 * (the house rule for anything touching localStorage). Reads are guarded
 * because private-mode browsers throw on access.
 */

import { useSyncExternalStore } from "react";

export const ADMIN_USERS_VIEW_KEY = "espace-admin-users-view";
export const ADMIN_USERS_VIEW_CHANGE_EVENT = "espace-admin-users-view:change";

export const ADMIN_USERS_VIEWS = ["table", "detail"];
const DEFAULT_VIEW = "table";

function normalise(value) {
  return ADMIN_USERS_VIEWS.includes(value) ? value : DEFAULT_VIEW;
}

export function getUsersView() {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  try {
    return normalise(window.localStorage.getItem(ADMIN_USERS_VIEW_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

export function setUsersView(next) {
  const value = normalise(next);
  if (typeof window === "undefined") return value;
  try {
    window.localStorage.setItem(ADMIN_USERS_VIEW_KEY, value);
  } catch {
    /* private mode — the in-memory broadcast below still works */
  }
  window.dispatchEvent(new Event(ADMIN_USERS_VIEW_CHANGE_EVENT));
  return value;
}

function subscribe(onChange) {
  if (typeof window === "undefined") return () => {};
  // Same-tab writes fire the custom event; other tabs arrive via `storage`.
  window.addEventListener(ADMIN_USERS_VIEW_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(ADMIN_USERS_VIEW_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * `[view, setView]`. Server-rendered HTML always says "table" so the
 * first client paint can't mismatch; the stored value lands on hydration.
 */
export function useUsersView() {
  const view = useSyncExternalStore(subscribe, getUsersView, () => DEFAULT_VIEW);
  return [view, setUsersView];
}
