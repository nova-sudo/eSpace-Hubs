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
  }, []);
  const state = readNotifications();
  return {
    ...state,
    markRead: markNotificationRead,
    markAll: markAllNotificationsRead,
    refresh: fetchNotifications,
  };
}
