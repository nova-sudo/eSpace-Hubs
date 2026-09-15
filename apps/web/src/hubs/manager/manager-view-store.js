"use client";

/**
 * Device-local "which view am I in" store for the manager portal.
 *
 * Two surfaces switch between layouts of the same data — the team page
 * (table / queue / people) and a report's board (board / consistency) —
 * and the pick belongs to the DEVICE, not the person: a lead on a wide
 * monitor wants the table, the same lead on a laptop wants the queue.
 * That rules out the synced prefs store, so this is localStorage with a
 * change event, the same shape every other local store in the app uses
 * (see features/goal-locks/locks-store.js): write → persist → notify, so
 * a sibling hook in another tree (or another tab, via `storage`) re-reads
 * instead of drifting.
 *
 * Pure CRUD — no React, no UI.
 */

export const MANAGER_VIEW_CHANGE_EVENT = "manager-view:change";

/** The two keys this store owns, so callers never hand-type them. */
export const TEAM_VIEW_KEY = "espace-manager-view";
export const BOARD_VIEW_KEY = "espace-manager-board-view";

const subscribers = new Set();

function notify() {
  for (const cb of subscribers) cb();
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(MANAGER_VIEW_CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

/** The stored view for `key`, or `fallback` when unset/invalid/SSR. */
export function readManagerView(key, allowed, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw && allowed.includes(raw)) return raw;
  } catch {
    /* private mode — fall through */
  }
  return fallback;
}

export function writeManagerView(key, value) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode — the pick just doesn't persist */
  }
  notify();
}

/**
 * Subscribe to local writes AND to other tabs' writes (the `storage`
 * event only fires in the tabs that did NOT make the change, which is
 * exactly the cross-tab case this covers).
 */
export function subscribeManagerView(cb) {
  subscribers.add(cb);
  const onStorage = (e) => {
    if (!e.key || e.key === TEAM_VIEW_KEY || e.key === BOARD_VIEW_KEY) cb();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    subscribers.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}
