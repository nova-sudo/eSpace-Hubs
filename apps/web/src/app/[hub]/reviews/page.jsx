import { AppShell } from "@/components/shell/app-shell";
import { PrReviewsPage } from "@/features/pr-reviews";

// Reads `?pr=<id>` via `useSearchParams` to deep-link a specific PR from
// the dashboard tile, so the route cannot be statically prerendered.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell>
      <PrReviewsPage />
    </AppShell>
  );
}
