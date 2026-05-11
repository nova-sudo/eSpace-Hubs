"use client";

/**
 * /[hub]/users — admin user management.
 *
 * Currently only the `admin` hub exposes this slot. Slot guard
 * redirects users on other hubs back to their dashboard.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { getAdminSlotComponent } from "@/hubs/dashboard-registry";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("users");
  if (!exposed) return null;
  const Component = getAdminSlotComponent("users");
  return (
    <AppShell>
      {Component ? <Component /> : null}
    </AppShell>
  );
}
