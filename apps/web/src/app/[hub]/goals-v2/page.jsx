"use client";

/**
 * /[hub]/goals-v2 — flow-map preview of the Goals page (Phase 1).
 *
 * Dev-hub only, and deliberately NOT in the nav — reachable only by direct
 * URL while this is being built out in phases. See
 * docs/plans (design handoff) for the full design; `features/goals-flow`
 * for the implementation phases.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { GoalsFlowPage } from "@/features/goals-flow";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("goalsv2");
  if (!exposed) return null;
  return (
    <AppShell>
      <GoalsFlowPage />
    </AppShell>
  );
}
