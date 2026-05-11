"use client";

/**
 * Hub-dashboard route. Renders the active hub's dashboard component
 * picked from apps/web/src/hubs/dashboard-registry.jsx.
 *
 *   /dev   → DashboardPage (the full bento dashboard the app started as)
 *   /qa    → <QaPlaceholder slot="dashboard" />
 *   /<new> → DefaultDashboardPlaceholder until the registry maps it
 *
 * HubProvider in app/[hub]/layout.jsx has already validated the slug
 * and applied the hub theme, so by the time we render here the hub
 * is guaranteed non-null (we use useActiveHubStrict to assert that).
 */

import { AppShell } from "@/components/shell/app-shell";
import { useActiveHubStrict } from "@/features/hubs";
import { getDashboardComponent } from "@/hubs/dashboard-registry";

// The Dev dashboard reads `?range=<preset>` via useSearchParams, so
// Next.js must not attempt to statically prerender this route. The
// QA placeholder is happy either way; force-dynamic keeps the
// behaviour identical across hubs.
export const dynamic = "force-dynamic";

export default function HubDashboardRoute() {
  const hub = useActiveHubStrict();
  const Dashboard = getDashboardComponent(hub.id);
  return (
    <AppShell hideFooter>
      <Dashboard />
    </AppShell>
  );
}
