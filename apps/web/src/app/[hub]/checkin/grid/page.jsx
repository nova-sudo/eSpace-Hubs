"use client";

/**
 * /[hub]/checkin/grid — multi-week catch-up grid view.
 *
 * Same slot guard as the single-week page (`checkin`), so any hub
 * exposing the slot gets both pages.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { CheckinGridPage } from "@/features/checkin";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("checkin");
  if (!exposed) return null;
  return (
    <AppShell>
      <CheckinGridPage />
    </AppShell>
  );
}
