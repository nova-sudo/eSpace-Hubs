"use client";

/**
 * Header notification bell — unread badge + dropdown inbox. Mounted in
 * the app shell header (authed surfaces only).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { useHubLink } from "@/features/hubs";
import { humanizeIsoDays, notificationPath } from "./notification-kinds";
import { useNotifications } from "./use-notifications";

// Where each kind leads lives in ./notification-kinds.js — shared with
// the inbox page so a row opens the same place from either surface.

function ago(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export function NotificationBell() {
  const { items, unread, loading, error, markRead, markAll, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const router = useRouter();
  const link = useHubLink();

  const openNotification = (n) => {
    if (!n.read) markRead(n.id);
    const path = notificationPath(n);
    if (path) {
      setOpen(false);
      router.push(link(path));
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key !== "Escape") return;
      // Hand focus back to the bell — closing the popover used to drop it
      // on whatever page element came next. Only when focus was in the
      // popover (or on the bell / nowhere), so it's never stolen.
      const focusWasOurs =
        (ref.current && ref.current.contains(document.activeElement)) ||
        document.activeElement === document.body;
      setOpen(false);
      if (focusWasOurs) buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <IconButton
        ref={buttonRef}
        label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "notification-bell-popover" : undefined}
        onClick={() => setOpen((o) => !o)}
        className="relative"
      >
        <Bell size={17} />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-peach-text"
            style={{ boxShadow: "0 0 0 2px var(--card)" }}
          />
        ) : null}
      </IconButton>

      {open ? (
        <div
          id="notification-bell-popover"
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[var(--radius-xl)] bg-card p-2"
          style={{ boxShadow: "var(--shadow-float)" }}
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[14.5px] font-bold text-fg">Notifications</span>
            {unread > 0 ? (
              <Button variant="soft" size="sm" onClick={markAll}>
                Mark all read
              </Button>
            ) : null}
          </div>

          <div className="max-h-[min(60vh,420px)] overflow-y-auto">
            {loading ? (
              <p className="px-3 py-8 text-center text-[12.5px] text-muted-fg">
                Loading…
              </p>
            ) : error && items.length === 0 ? (
              // A failed fetch is not an empty inbox — say so, offer a retry.
              <div className="flex flex-col items-center gap-2.5 px-3 py-8 text-center">
                <p className="text-[12.5px] font-semibold text-fg">Couldn&apos;t load notifications</p>
                <p className="text-[12px] text-muted-fg">{error?.message || "Check your connection and try again."}</p>
                <Button variant="soft" size="sm" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            ) : items.length === 0 ? (
              <p className="px-3 py-8 text-center text-[12.5px] text-muted-fg">
                You're all caught up.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNotification(n)}
                  className="flex w-full items-start gap-2.5 rounded-[var(--radius-lg)] px-3 py-2.5 text-left transition-colors hover:bg-card-alt"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 flex-none rounded-full",
                      n.read ? "bg-transparent" : "bg-ink",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold leading-snug text-fg">
                      {humanizeIsoDays(n.title)}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-fg">
                      {humanizeIsoDays(n.body)}
                    </span>
                    {typeof n.data?.note === "string" && n.data.note ? (
                      <span className="mt-1 block whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-card-alt px-2 py-1.5 text-[12px] leading-snug text-fg">
                        <span className="font-semibold text-muted-fg">Note: </span>
                        {n.data.note}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-[11.5px] text-muted-fg">
                      {ago(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          {/* The bell shows the newest few; the inbox page pages back
              through everything and holds the unread filter. */}
          <div className="mt-1 border-t border-line px-2 pt-1.5">
            <Link
              href={link("/notifications")}
              onClick={() => setOpen(false)}
              className="block rounded-[var(--radius-md)] px-2 py-2 text-center text-[12.5px] font-bold text-fg transition-colors hover:bg-card-alt"
            >
              View all notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
