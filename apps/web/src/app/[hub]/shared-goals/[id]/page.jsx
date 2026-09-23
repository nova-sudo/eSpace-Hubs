"use client";

/**
 * /[hub]/shared-goals/:id — one shared goal's analytics (creator or viewer;
 * anyone else gets the API's 404).
 */

import { useParams } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { SharedWithMePage } from "@/features/assigned-goals";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("sharedgoals");
  const params = useParams();
  if (!exposed) return null;
  const raw = params?.id;
  const id = Array.isArray(raw) ? raw[0] : (raw ?? null);
  return (
    <AppShell>
      <SharedWithMePage goalId={id} />
    </AppShell>
  );
}
