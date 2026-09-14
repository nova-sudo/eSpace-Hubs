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
import { useHubLink } from "@/features/hubs";
import { useNotifications } from "./use-notifications";

/**
 * Where a notification kind leads. Rows used to only mark-as-read — an
 * inbox with no follow-through — and the manager's rejection note lived
 * in `data` that nothing rendered, so "why was my goal sent back?" was
 * unanswerable from the UI. Links go through useHubLink; a hub that
 * doesn't expose the slot bounces to its dashboard via the slot guard.
 */
const KIND_PATH = {
  manager_graded: "/goals",
  goal_approved: "/goals",
  goal_changes_requested: "/goals",
  goal_submitted: "/approvals",
  user_pending_approval: "/users",
  review_packet_submitted: "/employees",
  // F4 scheduler kinds. Deadline nudges land on the goals editor (see
  // the date, adjust the plan); stale nudges land on the fill surface;
  // approval waits land where the manager acts.
  goal_due_soon: "/goals",
  goal_overdue: "/goals",
  goal_stale: "/",
  approval_waiting: "/approvals",
  // F6 — criteria changed under one of the recipient's goals; the tier
  // ladder shows on the fill surface.
  tier_policy_updated: "/",
};

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
  const router = useRouter();
  const link = useHubLink();

  const openNotification = (n) => {
    if (!n.read) markRead(n.id);
    const path = KIND_PATH[n.kind];
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
      <IconButton
        label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative"
      >
        <Bell size={17} />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-peach-ink"
            style={{ boxShadow: "0 0 0 2px var(--card)" }}
          />
        ) : null}
      </IconButton>

      {open ? (
        <div
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
                      {n.title}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-fg">
                      {n.body}
                    </span>
                    {typeof n.data?.note === "string" && n.data.note ? (
                      <span className="mt-1 block text-[12px] italic leading-snug text-muted-fg">
                        &ldquo;{n.data.note}&rdquo;
                      </span>
                    ) : null}
                    <span className="mt-1 block text-[11.5px] text-dim-fg">
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
