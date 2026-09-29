"use client";

/**
 * SWR keys for the full inbox (use-notification-inbox). Shared with the
 * bell store so a mark-read in the bell revalidates an open inbox page —
 * the two views never disagree.
 */

import { mutate } from "swr";
import { unstable_serialize } from "swr/infinite";

export const INBOX_PAGE_SIZE = 30;

/** useSWRInfinite key loader for the inbox, all or unread-only. */
export function inboxKeyLoader(unreadOnly) {
  return (pageIndex, prev) => {
    if (prev && !prev.hasMore) return null;
    const p = new URLSearchParams({ limit: String(INBOX_PAGE_SIZE) });
    if (unreadOnly) p.set("unread", "1");
    if (pageIndex > 0) {
      if (!prev?.nextCursor) return null;
      p.set("cursor", prev.nextCursor);
    }
    return `/notifications?${p.toString()}`;
  };
}

// Stable loaders so `unstable_serialize` yields the same cache key the
// hook registered under.
export const INBOX_ALL = inboxKeyLoader(false);
export const INBOX_UNREAD = inboxKeyLoader(true);

/** Revalidate both inbox views (called after a bell mutation). */
export function revalidateInbox() {
  void mutate(unstable_serialize(INBOX_ALL));
  void mutate(unstable_serialize(INBOX_UNREAD));
}
