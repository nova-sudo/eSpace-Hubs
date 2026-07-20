"use client";

/**
 * /[hub]/delegated — the manager's delegated-goal queue.
 *
 * Only the `manager` hub exposes this slot; the slot guard bounces users
 * on other hubs back to their dashboard.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { getManagerSlotComponent } from "@/hubs/dashboard-registry";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("delegated");
  if (!exposed) return null;
  const Component = getManagerSlotComponent("delegated");
  return <AppShell>{Component ? <Component /> : null}</AppShell>;
}
