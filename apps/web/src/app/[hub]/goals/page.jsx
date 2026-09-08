"use client";

/**
 * /[hub]/goals — the goal flow map. Cutover: this route used to render the
 * two-section `GoalsPage` (tree tile + evidence strip + widget grid); the
 * flow map that was previewed at `/[hub]/goals-v2` is now the Goals page.
 *
 * Only hubs whose registry exposes a `goals` slot (dev, qa) render this —
 * without the gate, /manager/goals and /admin/goals served the Dev surface
 * verbatim (hub-audit §3.1).
 *
 * Reverting is a one-liner: swap `GoalsFlowPage` back for `GoalsPage` from
 * `@/features/goals` — the old page's code is untouched, just unrouted.
 */

import { AppShell } from "@/components/shell/app-shell";
import { HubSlotGate } from "@/features/hubs";
import { GoalsFlowPage } from "@/features/goals-flow";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <HubSlotGate slot="goals">
      <AppShell>
        <GoalsFlowPage />
      </AppShell>
    </HubSlotGate>
  );
}
