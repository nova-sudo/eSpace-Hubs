"use client";

/**
 * In-app notifications store. Caches GET /api/v1/notifications and the
 * unread count, with optimistic mark-read. Module-level external store
 * (useSyncExternalStore) mirroring the session/goal-tier stores. Reset on
 * auth transition so one user's inbox never leaks to the next.
 *
 * Not real-time: the bell fetches once on mount and after a mutation.
 * That's enough for v1 — a manager grade lands in the recipient's inbox
 * on their next load / bell open.
 */

import { apiGet, apiPost } from "@/lib/api-client";

let state = { loading: true, items: [], unread: 0, error: null };
let tick = 0;
let fetchedOnce = false;
const CHANGE_EVENT = "notifications:change";

function notify() {
  tick += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeNotifications(cb) {
  if (typeof window === "undefined") return () => {};
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}
export function getNotificationsSnapshot() {
  return tick;
}
export function getNotificationsServerSnapshot() {
  return 0;
}
export function readNotifications() {
  return state;
}

export async function fetchNotifications() {
  const r = await apiGet("/notifications");
  if (r.ok) {
    state = {
      loading: false,
      items: r.data?.notifications ?? [],
      unread: r.data?.unread ?? 0,
      error: null,
    };
  } else {
    state = { ...state, loading: false, error: r.error ?? "error" };
  }
  notify();
}

/** Fire the first fetch exactly once (bell mount). */
export function ensureNotifications() {
  if (fetchedOnce) return;
  fetchedOnce = true;
  void fetchNotifications();
}

export async function markNotificationRead(id) {
  const wasUnread = state.items.some((n) => n.id === id && !n.read);
  state = {
    ...state,
    items: state.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
    unread: wasUnread ? Math.max(0, state.unread - 1) : state.unread,
  };
  notify();
  await apiPost(`/notifications/${id}/read`, {});
}

export async function markAllNotificationsRead() {
  state = {
    ...state,
    items: state.items.map((n) => ({ ...n, read: true })),
    unread: 0,
  };
  notify();
  await apiPost("/notifications/read-all", {});
}

export function resetNotifications() {
  state = { loading: true, items: [], unread: 0, error: null };
  fetchedOnce = false;
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetNotifications);
}
