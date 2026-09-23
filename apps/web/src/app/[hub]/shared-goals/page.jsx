"use client";

/**
 * /[hub]/shared-goals — shared goals you can view (every hub exposes it).
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { SharedWithMePage } from "@/features/assigned-goals";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("sharedgoals");
  if (!exposed) return null;
  return (
    <AppShell>
      <SharedWithMePage />
    </AppShell>
  );
}
