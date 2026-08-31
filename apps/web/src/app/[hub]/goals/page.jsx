import { AppShell } from "@/components/shell/app-shell";
import { HubSlotGate } from "@/features/hubs";
import { GoalsTabPage } from "@/features/dashboard";

// Only hubs whose registry exposes a `goals` slot (dev, qa) render this —
// without the gate, /manager/goals and /admin/goals served the Dev surface
// verbatim (hub-audit §3.1).
export default function Page() {
  return (
    <HubSlotGate slot="goals">
      <AppShell>
        <GoalsTabPage />
      </AppShell>
    </HubSlotGate>
  );
}
