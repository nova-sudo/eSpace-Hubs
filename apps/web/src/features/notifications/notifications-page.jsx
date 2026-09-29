"use client";

/**
 * /[hub]/notifications — the whole inbox (hub-audit §3.4). The bell shows
 * the newest few; this page pages back through everything the server
 * keeps (180-day TTL), filters to unread, and links to Settings →
 * Notifications for mutes and email. Every hub exposes the slot.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Loading, PageHeader, SegmentedControl } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useHubLink } from "@/features/hubs";
import { humanizeIsoDays, notificationPath } from "./notification-kinds";
import { useNotificationInbox } from "./use-notification-inbox";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
];

function when(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function NotificationsPage() {
  const [filter, setFilter] = useState("all");
  const inbox = useNotificationInbox({ unreadOnly: filter === "unread" });
  const router = useRouter();
  const link = useHubLink();

  const open = (n) => {
    if (!n.read) void inbox.markRead(n.id);
    const path = notificationPath(n);
    if (path) router.push(link(path));
  };

  return (
    <main className="mx-auto max-w-[860px] px-4 pb-16 pt-7 sm:px-10">
      <PageHeader
        crumb="Inbox"
        title="Notifications."
        subtitle={
          <>
            Everything the app has told you in the last six months. Mute kinds you don&apos;t
            need, or turn email off, in{" "}
            <Link href={link("/settings?tab=notifications")} className="font-semibold text-fg underline">
              Settings → Notifications
            </Link>
            .
          </>
        }
        right={
          <div className="flex items-center gap-2">
            <SegmentedControl as="radiogroup" ariaLabel="Filter notifications" size="sm" options={FILTERS} value={filter} onChange={setFilter} />
            {inbox.unread > 0 ? (
              <Button variant="soft" size="sm" onClick={() => void inbox.markAll()}>
                Mark all read
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="rounded-[var(--radius-xl)] bg-card p-2" style={{ boxShadow: "var(--shadow-card)" }}>
        {inbox.loading ? (
          <Loading label="Loading notifications" />
        ) : inbox.error ? (
          <div className="flex flex-col items-center gap-2.5 px-3 py-10 text-center">
            <p className="text-[13px] font-semibold text-fg">Couldn&apos;t load notifications</p>
            <p className="text-[12.5px] text-muted-fg">{inbox.error}</p>
            <Button variant="soft" size="sm" onClick={() => void inbox.reload()}>
              Retry
            </Button>
          </div>
        ) : inbox.items.length === 0 ? (
          <p className="px-3 py-10 text-center text-[13px] text-muted-fg">
            {filter === "unread" ? "Nothing unread." : "No notifications yet."}
          </p>
        ) : (
          <ul>
            {inbox.items.map((n, i) => (
              <li key={n.id} className={cn(i > 0 && "border-t border-line")}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className="flex w-full items-start gap-3 rounded-[var(--radius-lg)] px-3 py-3 text-left transition-colors hover:bg-card-alt"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 flex-none rounded-full",
                      n.read ? "bg-transparent" : "bg-ink",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className={cn("text-[13.5px] leading-snug text-fg", n.read ? "font-semibold" : "font-bold")}>
                        {humanizeIsoDays(n.title)}
                      </span>
                      <span className="text-[11.5px] tabular-nums text-muted-fg">{when(n.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-fg">{humanizeIsoDays(n.body)}</span>
                    {typeof n.data?.note === "string" && n.data.note ? (
                      <span className="mt-1.5 block whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-card-alt px-2.5 py-1.5 text-[12px] leading-snug text-fg">
                        <span className="font-semibold text-muted-fg">Note: </span>
                        {n.data.note}
                      </span>
                    ) : null}
                  </span>
                  <span className="sr-only">{n.read ? "Read" : "Unread"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {inbox.hasMore ? (
        <div className="mt-4 flex justify-center">
          <Button variant="soft" size="sm" disabled={inbox.loadingMore} onClick={() => void inbox.loadMore()}>
            {inbox.loadingMore ? "Loading…" : "Load older"}
          </Button>
        </div>
      ) : null}
    </main>
  );
}
