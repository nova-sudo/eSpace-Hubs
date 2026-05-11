"use client";

/**
 * /[hub]/snapshots — weekly metric snapshots. Currently a Dev-Hub-only
 * slot; the QA Hub's registry doesn't include `snapshots` in its
 * pages map.
 *
 * useHubSlotGuard redirects to the hub's dashboard when the slot
 * isn't exposed.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { SnapshotsPage } from "@/features/snapshots";

export default function Page() {
  const exposed = useHubSlotGuard("snapshots");
  if (!exposed) return null;
  return (
    <AppShell>
      <SnapshotsPage />
    </AppShell>
  );
}
