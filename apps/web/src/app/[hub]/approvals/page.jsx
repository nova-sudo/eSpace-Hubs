"use client";

/**
 * /[hub]/approvals — the manager's Build-Your-Own approvals queue.
 *
 * Only the `manager` hub exposes this slot; the slot guard bounces users
 * on other hubs back to their dashboard.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { getManagerSlotComponent } from "@/hubs/dashboard-registry";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("approvals");
  if (!exposed) return null;
  const Component = getManagerSlotComponent("approvals");
  return <AppShell>{Component ? <Component /> : null}</AppShell>;
}
