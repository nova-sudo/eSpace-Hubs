"use client";

/**
 * /[hub]/notifications — the full inbox behind the bell's "View all".
 * Every hub exposes the `notifications` slot; the guard still runs so an
 * org that hid it in hub config is respected.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { NotificationsPage } from "@/features/notifications";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("notifications");
  if (!exposed) return null;
  return (
    <AppShell>
      <NotificationsPage />
    </AppShell>
  );
}
