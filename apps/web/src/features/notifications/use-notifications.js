"use client";

/**
 * Hook over the notifications store. Subscribes for re-render, fires the
 * one-shot initial fetch, and exposes the mutators.
 */

import { useEffect, useSyncExternalStore } from "react";
import {
  ensureNotifications,
  fetchNotifications,
  getNotificationsServerSnapshot,
  getNotificationsSnapshot,
  markAllNotificationsRead,
  markNotificationRead,
  readNotifications,
  subscribeNotifications,
} from "./notifications-store";

export function useNotifications() {
  useSyncExternalStore(
    subscribeNotifications,
    getNotificationsSnapshot,
    getNotificationsServerSnapshot,
  );
  useEffect(() => {
    ensureNotifications();
    // Audit #238: the inbox was fetched exactly once per bell MOUNT — in
    // an SPA the bell mounts once per tab, so a manager grade landed
    // hours before the badge showed it (or never, without a reload).
    // A 90s poll keeps the badge honest; the F4 scheduler writes rows
    // server-side, so pull cadence is the only freshness lever the
    // client has (no SSE channel for notifications yet).
    const id = setInterval(() => void fetchNotifications(), 90_000);
    return () => clearInterval(id);
  }, []);
  const state = readNotifications();
  return {
    ...state,
    markRead: markNotificationRead,
    markAll: markAllNotificationsRead,
    refresh: fetchNotifications,
  };
}
