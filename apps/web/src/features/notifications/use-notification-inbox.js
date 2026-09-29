"use client";

/**
 * The full inbox (hub-audit §3.4): pages through GET /notifications with
 * the server's keyset cursor, optionally unread-only. SWR-backed
 * (`useSWRInfinite`); the bell's store revalidates these keys after its
 * own mark-read / mark-all (inbox-keys.js), and every mutation here
 * re-syncs the bell (`fetchNotifications`) so the badge never disagrees
 * with the page.
 */

import { useCallback, useRef } from "react";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api-client";
import { fetchNotifications } from "./notifications-store";
import { INBOX_ALL, INBOX_UNREAD } from "./inbox-keys";

async function fetchPage(key) {
  const r = await apiGet(key);
  if (!r.ok) throw new Error(r.error?.message || "Couldn't load notifications.");
  return {
    notifications: r.data?.notifications ?? [],
    unread: r.data?.unread ?? 0,
    hasMore: Boolean(r.data?.hasMore),
    nextCursor: r.data?.nextCursor ?? null,
  };
}

function markPages(pages, pred) {
  let flipped = 0;
  const next = (pages || []).map((p) => ({
    ...p,
    notifications: p.notifications.map((n) => {
      if (n.read || !pred(n)) return n;
      flipped += 1;
      return { ...n, read: true };
    }),
  }));
  return next.map((p) => ({ ...p, unread: Math.max(0, p.unread - flipped) }));
}

export function useNotificationInbox({ unreadOnly = false } = {}) {
  const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite(
    unreadOnly ? INBOX_UNREAD : INBOX_ALL,
    fetchPage,
    { revalidateFirstPage: false, revalidateOnFocus: false },
  );
  // Ids with a mark-read POST in flight — a double click must POST once.
  const pending = useRef(new Set());

  const pages = data ?? [];
  const items = pages.flatMap((p) => p.notifications);
  const last = pages[pages.length - 1];
  const hasMore = Boolean(last?.hasMore && last?.nextCursor);
  const loadingMore = isValidating && size > pages.length;

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    void setSize((s) => s + 1).catch((e) =>
      toast.error(e?.message || "Couldn't load more notifications."),
    );
  }, [hasMore, loadingMore, setSize]);

  const markRead = useCallback(
    async (id) => {
      const row = items.find((n) => n.id === id);
      if (!row || row.read || pending.current.has(id)) return;
      pending.current.add(id);
      await mutate((cur) => markPages(cur, (n) => n.id === id), { revalidate: false });
      const r = await apiPost(`/notifications/${id}/read`, {});
      pending.current.delete(id);
      if (!r.ok) {
        toast.error(r.error?.message || "Couldn't mark the notification as read.");
        void mutate();
        return;
      }
      void fetchNotifications();
    },
    [items, mutate],
  );

  const markAll = useCallback(async () => {
    await mutate((cur) => markPages(cur, () => true), { revalidate: false });
    const r = await apiPost("/notifications/read-all", {});
    if (!r.ok) {
      toast.error(r.error?.message || "Couldn't mark all notifications as read.");
      void mutate();
      return;
    }
    void fetchNotifications();
  }, [mutate]);

  return {
    loading: isLoading && !data,
    loadingMore,
    error: !data && error ? error.message : null,
    items,
    unread: pages[0]?.unread ?? 0,
    hasMore,
    loadMore,
    markRead,
    markAll,
    reload: () => mutate(),
  };
}
