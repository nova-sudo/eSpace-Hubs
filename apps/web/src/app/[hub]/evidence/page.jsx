import { AppShell } from "@/components/shell/app-shell";
import { EvidencePage } from "@/features/evidence";

// Evidence page reads `?view=compile` / `?print=1` via `useSearchParams` to
// deep-link straight into the document builder (where you export a real .pdf
// or .md). That means the route cannot be statically prerendered.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell>
      <EvidencePage />
    </AppShell>
  );
}
