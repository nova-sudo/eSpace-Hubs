"use client";

/**
 * Header notification bell — unread badge + dropdown inbox. Mounted in
 * the app shell header (authed surfaces only). Theme-aware via tokens, so
 * the badge/accent follow the active hub (cobalt on Dev, orange on the
 * Manager hub).
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useNotifications } from "./use-notifications";

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
  const { items, unread, loading, markRead, markAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => {
      if (e.key === "Escape") setOpen(false);
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
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-8 w-8 place-items-center rounded-md text-muted-fg transition-colors hover:bg-accent-dim/60 hover:text-fg"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 ? (
          <span
            className="absolute -right-1 -top-1 grid min-w-[16px] place-items-center rounded-full px-1 text-accent-on"
            style={{
              height: 16,
              background: "var(--accent)",
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 700,
              border: "2px solid var(--bg)",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border bg-card"
          style={{
            borderColor: "var(--border-strong)",
            boxShadow: "0 24px 60px -24px rgba(20,12,0,0.4)",
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span
              className="uppercase tracking-[0.08em] text-fg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700 }}
            >
              Notifications
            </span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAll}
                className="text-accent hover:underline"
                style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.03em" }}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[min(60vh,420px)] overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-muted-fg">
                Loading…
              </p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-muted-fg">
                You're all caught up.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.read && markRead(n.id)}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-card-alt",
                    !n.read && "bg-accent-dim/30",
                  )}
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full"
                    style={{ background: n.read ? "transparent" : "var(--accent)" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold leading-snug">
                      {n.title}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-fg">
                      {n.body}
                    </span>
                    <span
                      className="mt-1 block text-dim-fg"
                      style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.03em" }}
                    >
                      {ago(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
