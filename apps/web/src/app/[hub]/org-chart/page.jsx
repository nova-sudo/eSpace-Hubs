"use client";

/**
 * /[hub]/org-chart — the reporting tree built from users.managerId.
 * Only the `admin` hub exposes the `orgchart` slot; the guard bounces
 * everyone else to their dashboard.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { getAdminSlotComponent } from "@/hubs/dashboard-registry";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("orgchart");
  if (!exposed) return null;
  const Component = getAdminSlotComponent("orgchart");
  return <AppShell>{Component ? <Component /> : null}</AppShell>;
}
