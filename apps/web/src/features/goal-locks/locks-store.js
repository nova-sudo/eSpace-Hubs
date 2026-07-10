"use client";

/**
 * Goal window LOCKS — "this period is finalised; stop nagging me."
 *
 * A lock records that the user has consciously addressed a goal's cadence
 * window — either it's done, or it's intentionally empty ("nothing to
 * report"). A locked window is no longer "owed", so the status model treats
 * it as settled regardless of whether it holds data. This is the user's
 * escape hatch from the rolling-window inference: the app can't tell "didn't
 * get to it" from "nothing happened" — the lock lets the user say which.
 *
 * Persistence: localStorage, device-local — the same localStorage-first
 * pattern `prefs` used before graduating to API-direct. User-scoped, so the
 * key is wiped on every auth transition (see clear-user-storage.js).
 * Promoting locks to cross-device sync = move this to an API-direct store
 * later; the public surface here stays the same.
 *
 * Shape: { "<goalId>::<windowKey>": true }. Absent / false === unlocked.
 */

export const LOCKS_STORAGE_KEY = "espace-devhub:goal-locks";
export const LOCKS_CHANGE_EVENT = "goal-locks:change";

let tick = 0;

function keyOf(goalId, windowKey) {
  return `${goalId}::${windowKey}`;
}

export function readLocks() {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LOCKS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function isLocked(goalId, windowKey) {
  if (!goalId || !windowKey) return false;
  return readLocks()[keyOf(goalId, windowKey)] === true;
}

function write(next) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCKS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / disabled storage */
  }
  tick += 1;
  try {
    window.dispatchEvent(new Event(LOCKS_CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function setLock(goalId, windowKey, locked) {
  if (!goalId || !windowKey) return;
  const locks = readLocks();
  const k = keyOf(goalId, windowKey);
  if (locked) {
    if (locks[k] === true) return;
    write({ ...locks, [k]: true });
  } else {
    if (!(k in locks)) return;
    const next = { ...locks };
    delete next[k];
    write(next);
  }
}

export function toggleLock(goalId, windowKey) {
  setLock(goalId, windowKey, !isLocked(goalId, windowKey));
}

/**
 * isLocked, with a one-way migration fallback to the legacy "all" bucket.
 *
 * Before COMPOSED goals resolved their own cadence (they used to fall
 * through to `currentWindowKey(undefined)` → "all"), a "nothing to report"
 * lock on a composed goal was written under `<goalId>::all`. Once cadence
 * resolution was fixed, `windowKey` became a real per-window key (e.g.
 * "2026-07") that never matches that old entry — silently un-finalizing
 * every composed goal a user had already settled. Falling back to "all"
 * when the real key isn't locked keeps those pre-fix locks honored.
 */
export function isCurrentWindowLocked(goalId, windowKey) {
  if (isLocked(goalId, windowKey)) return true;
  if (windowKey !== "all" && isLocked(goalId, "all")) return true;
  return false;
}

/** Reopen the current window — clears both the real key and any legacy
 * "all" leftover, so a stale pre-migration lock can't keep re-settling it. */
export function reopenCurrentWindow(goalId, windowKey) {
  setLock(goalId, windowKey, false);
  if (windowKey !== "all") setLock(goalId, "all", false);
}

/* ─────────────────── useSyncExternalStore plumbing ─────────────────── */

export function subscribeLocks(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(LOCKS_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler); // cross-tab
  return () => {
    window.removeEventListener(LOCKS_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function getLocksSnapshot() {
  return tick;
}

export function getLocksServerSnapshot() {
  return 0;
}
