import { AppShell } from "@/components/shell/app-shell";
import { EvidencePage } from "@/features/evidence";

// Evidence page reads `?print=1` via `useSearchParams` to auto-trigger the
// browser print dialog when deep-linked from the dashboard Export tile.
// That means the route cannot be statically prerendered.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell>
      <EvidencePage />
    </AppShell>
  );
}
