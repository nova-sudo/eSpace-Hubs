"use client";

/**
 * /[hub]/approvals — Build-Your-Own approvals.
 *
 *   manager hub → the manager's queue (their reports' trackers)
 *   admin hub   → trackers from people with no active manager, which the
 *                 approval gate routes to the org's admins (hub-audit §1.3)
 *
 * Both hubs register the `approvals` slot; any other hub is bounced to
 * its dashboard by the slot guard.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useActiveHub, useHubSlotGuard } from "@/features/hubs";
import {
  getAdminSlotComponent,
  getManagerSlotComponent,
} from "@/hubs/dashboard-registry";

export const dynamic = "force-dynamic";

export default function Page() {
  const hub = useActiveHub();
  const exposed = useHubSlotGuard("approvals");
  if (!exposed) return null;
  const Component =
    hub?.id === "admin"
      ? getAdminSlotComponent("approvals")
      : getManagerSlotComponent("approvals");
  return <AppShell>{Component ? <Component /> : null}</AppShell>;
}
