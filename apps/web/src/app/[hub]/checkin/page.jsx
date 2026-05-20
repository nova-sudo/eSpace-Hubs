"use client";

/**
 * /[hub]/checkin — weekly check-in page.
 *
 * Slot id: "checkin". Currently enabled for the Dev hub only via
 * packages/shared/src/hubs/registry.js. Other hubs' `pages` maps
 * don't include it, so the slot guard redirects to the hub's
 * dashboard for them.
 *
 * The route reads `?week=...` via useSearchParams in the child
 * (CheckinPage → useCheckinWeek), so it must opt out of static
 * prerender. force-dynamic mirrors the dashboard route's setup.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { CheckinPage } from "@/features/checkin";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("checkin");
  if (!exposed) return null;
  return (
    <AppShell>
      <CheckinPage />
    </AppShell>
  );
}
