"use client";

/**
 * /[hub]/audit — admin audit-log viewer.
 *
 * Currently only the `admin` hub exposes this slot. Slot guard
 * redirects users on other hubs back to their dashboard.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { getAdminSlotComponent } from "@/hubs/dashboard-registry";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("audit");
  if (!exposed) return null;
  const Component = getAdminSlotComponent("audit");
  return (
    <AppShell>
      {Component ? <Component /> : null}
    </AppShell>
  );
}
