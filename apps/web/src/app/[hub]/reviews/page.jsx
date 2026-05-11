"use client";

/**
 * /[hub]/reviews — the PR review log. Currently a Dev-Hub-only slot;
 * the QA Hub's registry doesn't include `reviews` in its pages map.
 *
 * useHubSlotGuard checks the active hub's `pages.reviews` and, when
 * missing, redirects the user back to their hub's dashboard. Reads
 * `?pr=<id>` from useSearchParams to deep-link from the dashboard
 * tile, so the route is force-dynamic.
 */

import { AppShell } from "@/components/shell/app-shell";
import { useHubSlotGuard } from "@/features/hubs";
import { PrReviewsPage } from "@/features/pr-reviews";

export const dynamic = "force-dynamic";

export default function Page() {
  const exposed = useHubSlotGuard("reviews");
  if (!exposed) return null;
  return (
    <AppShell>
      <PrReviewsPage />
    </AppShell>
  );
}
