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

import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api-client";
import { revalidateInbox } from "./inbox-keys";

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

/**
 * Optimistic mark-read with rollback. Until now a failed POST left the row
 * looking read while the server still counted it unread — the badge came
 * back on the next poll with no explanation. Roll back to the pre-write
 * state (unless a later fetch already replaced it) and say so.
 */
function isAuthError(err) {
  return err?.code === "unauthenticated" || err?.code === "totp_required";
}

export async function markNotificationRead(id) {
  const prev = state;
  const wasUnread = state.items.some((n) => n.id === id && !n.read);
  if (!wasUnread) return;
  state = {
    ...state,
    items: state.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
    unread: Math.max(0, state.unread - 1),
  };
  notify();
  const r = await apiPost(`/notifications/${id}/read`, {});
  if (r.ok) revalidateInbox();
  if (r.ok || isAuthError(r.error)) return;
  if (state.items.some((n) => n.id === id && n.read)) {
    state = {
      ...state,
      items: state.items.map((n) => (n.id === id ? { ...n, read: false } : n)),
      unread: state.unread + 1,
    };
    notify();
  }
  toast.error("Couldn't mark the notification as read", {
    description: r.error?.message,
    action: { label: "Retry", onClick: () => void markNotificationRead(id) },
  });
}

function sameIds(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((n, i) => n.id === b[i].id);
}

export async function markAllNotificationsRead() {
  const prev = state;
  if (state.unread === 0 && state.items.every((n) => n.read)) return;
  const optimisticItems = state.items.map((n) => ({ ...n, read: true }));
  state = { ...state, items: optimisticItems, unread: 0 };
  notify();
  const r = await apiPost("/notifications/read-all", {});
  if (r.ok) revalidateInbox();
  if (r.ok || isAuthError(r.error)) return;
  // Only roll back if nothing refreshed the list in the meantime. Compare
  // ids, not counts: a same-size poll result is still a different list,
  // and restoring `prev` over it would resurrect stale rows.
  if (sameIds(state.items, optimisticItems)) {
    state = { ...state, items: prev.items, unread: prev.unread };
    notify();
  }
  toast.error("Couldn't mark all notifications as read", {
    description: r.error?.message,
    action: { label: "Retry", onClick: () => void markAllNotificationsRead() },
  });
}

export function resetNotifications() {
  state = { loading: true, items: [], unread: 0, error: null };
  fetchedOnce = false;
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("auth:user-storage-cleared", resetNotifications);
}
