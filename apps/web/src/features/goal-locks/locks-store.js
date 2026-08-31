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
 * Persistence (BL-011 closed): API-direct — `goal_locks` on the server is
 * the source of truth, hydrated once per session, with localStorage kept
 * as a synchronous warm-start cache (readLocks() is called from non-React
 * code on first render, before any fetch can resolve). Why this graduated
 * from device-local: the cadence-consistency CAP on displayed achievement
 * tiers reads these locks, so device-local state made the same goal show
 * different tiers per device, and a re-login (which wipes user-scoped
 * storage) silently degraded the user's own badge.
 *
 * Mutations are optimistic: local state + cache update immediately, the
 * PUT ({set/clear}) follows fire-and-forget; a failed write logs and the
 * next hydration reconciles. The auth-transition wipe still clears the
 * cache key and resets this module.
 *
 * Shape: { "<goalId>::<windowKey>": true }. Absent / false === unlocked.
 */

import { apiGet, apiPut } from "@/lib/api-client";

export const LOCKS_STORAGE_KEY = "espace-devhub:goal-locks";
export const LOCKS_CHANGE_EVENT = "goal-locks:change";

let tick = 0;
/** In-memory map — the synchronous read surface. Seeded from the
 *  localStorage cache on first read, replaced by the server on hydrate. */
let state = null; // null = not loaded from cache yet
let hydrated = false;
let hydrating = false;

function keyOf(goalId, windowKey) {
  return `${goalId}::${windowKey}`;
}

function loadCache() {
  if (state !== null || typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(LOCKS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    state = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    state = {};
  }
}

function persistCache() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCKS_STORAGE_KEY, JSON.stringify(state ?? {}));
  } catch {
    /* ignore quota / disabled storage */
  }
}

function notify() {
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(LOCKS_CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function readLocks() {
  loadCache();
  return state ?? {};
}

export function isLocked(goalId, windowKey) {
  if (!goalId || !windowKey) return false;
  return readLocks()[keyOf(goalId, windowKey)] === true;
}

/**
 * One-shot server hydration per session. The server's keys REPLACE the
 * local map (it is the source of truth; the cache is only a warm
 * start). 401 leaves it un-hydrated so a later mount retries once auth
 * settles. Safe to call from many mounts.
 */
export async function hydrateLocks() {
  if (hydrated || hydrating || typeof window === "undefined") return;
  hydrating = true;
  loadCache();
  try {
    const r = await apiGet("/goal-locks");
    if (!r.ok) {
      // Auth-flush 401s are normal; anything else logs and retries later.
      if (
        r.error?.code !== "unauthenticated" &&
        r.error?.code !== "totp_required"
      ) {
        // eslint-disable-next-line no-console
        console.warn("[goal-locks] hydrate failed:", r.error?.code);
      }
      return;
    }
    hydrated = true;
    const keys = Array.isArray(r.data?.keys) ? r.data.keys : [];
    const next = {};
    for (const k of keys) {
      if (typeof k === "string" && k) next[k] = true;
    }
    const changed = JSON.stringify(next) !== JSON.stringify(state ?? {});
    state = next;
    if (changed) {
      persistCache();
      notify();
    }
  } finally {
    hydrating = false;
  }
}

function applyLocal(setKeys, clearKeys) {
  loadCache();
  const next = { ...(state ?? {}) };
  let changed = false;
  for (const k of setKeys) {
    if (next[k] !== true) {
      next[k] = true;
      changed = true;
    }
  }
  for (const k of clearKeys) {
    if (k in next) {
      delete next[k];
      changed = true;
    }
  }
  if (!changed) return false;
  state = next;
  persistCache();
  notify();
  return true;
}

function pushRemote(setKeys, clearKeys) {
  if (setKeys.length === 0 && clearKeys.length === 0) return;
  void apiPut("/goal-locks", {
    ...(setKeys.length ? { set: setKeys } : {}),
    ...(clearKeys.length ? { clear: clearKeys } : {}),
  }).then((r) => {
    if (!r.ok && r.error?.code !== "unauthenticated" && r.error?.code !== "totp_required") {
      // eslint-disable-next-line no-console
      console.warn("[goal-locks] save failed:", r.error?.code, r.error?.message);
    }
  });
}

export function setLock(goalId, windowKey, locked) {
  if (!goalId || !windowKey) return;
  const k = keyOf(goalId, windowKey);
  const changed = locked ? applyLocal([k], []) : applyLocal([], [k]);
  if (changed) pushRemote(locked ? [k] : [], locked ? [] : [k]);
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
  const keys = windowKey !== "all" ? [keyOf(goalId, windowKey), keyOf(goalId, "all")] : [keyOf(goalId, windowKey)];
  const changed = applyLocal([], keys);
  if (changed) pushRemote([], keys);
}

/**
 * Drop every settle-lock for a goal. Used when re-analyzing wipes the goal's
 * history — a lock left on a now-empty window would read as "settled but
 * empty," so the clean slate clears the locks too. No-op when the goal has no
 * locks (nothing written, no change event).
 */
export function clearGoalLocks(goalId) {
  if (!goalId) return;
  const locks = readLocks();
  const prefix = `${goalId}::`;
  const doomed = Object.keys(locks).filter((k) => k.startsWith(prefix));
  if (doomed.length === 0) return;
  applyLocal([], doomed);
  pushRemote([], doomed);
}

/** Reset in-memory state (auth transitions). The storage key itself is
 *  wiped by clear-user-storage's allowlist; this clears the module copy
 *  so the next session re-hydrates for the new user. */
export function resetLocks() {
  state = null;
  hydrated = false;
  hydrating = false;
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetLocks);
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
