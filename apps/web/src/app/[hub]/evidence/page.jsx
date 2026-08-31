import { AppShell } from "@/components/shell/app-shell";
import { HubSlotGate } from "@/features/hubs";
import { EvidencePage } from "@/features/evidence";

// Evidence page reads `?view=compile` / `?print=1` via `useSearchParams` to
// deep-link straight into the document builder (where you export a real .pdf
// or .md). That means the route cannot be statically prerendered — and it's
// why this file stays a Server Component (segment config is server-only)
// with the slot check done by the HubSlotGate client wrapper (hub-audit §3.1).
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <HubSlotGate slot="evidence">
      <AppShell>
        <EvidencePage />
      </AppShell>
    </HubSlotGate>
  );
}
