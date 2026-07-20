"use client";

/**
 * /[hub]/employees — the manager's per-report boards (roster + detail).
 *
 * Currently only the `manager` hub exposes this slot; the slot guard
 * redirects users on other hubs back to their dashboard. The real board
 * UI lands in P1 — today this renders the manager placeholder.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { getManagerSlotComponent } from "@/hubs/dashboard-registry";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("employees");
  if (!exposed) return null;
  const Component = getManagerSlotComponent("employees");
  return <AppShell>{Component ? <Component /> : null}</AppShell>;
}
