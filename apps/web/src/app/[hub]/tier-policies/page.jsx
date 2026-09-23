"use client";

/**
 * /[hub]/tier-policies — "Goals & policies": shared goals (author, assign,
 * track) and manager-authored achievement-tier criteria by Goal Code, as
 * tabs. The URL + slot id keep the old name — stored hub configs use it.
 *
 * Currently only the `manager` hub exposes this slot; the slot guard
 * redirects users on other hubs back to their dashboard.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { getManagerSlotComponent } from "@/hubs/dashboard-registry";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("tierpolicies");
  if (!exposed) return null;
  const Component = getManagerSlotComponent("tierpolicies");
  return <AppShell>{Component ? <Component /> : null}</AppShell>;
}
