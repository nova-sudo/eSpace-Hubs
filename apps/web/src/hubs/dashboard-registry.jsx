"use client";

/**
 * Per-hub dashboard-component dispatch.
 *
 * Each hub gets ONE dashboard React component, picked by hub id at
 * /[hub]/page.jsx. The lookup is open-ended: new hubs added to the
 * shared registry just need a corresponding entry here. Hubs without
 * an entry fall through to <DefaultDashboardPlaceholder /> which
 * renders the same QA-placeholder shell so adding a new hub never
 * produces a broken page.
 *
 * Why a separate registry file (not inline in app/[hub]/page.jsx):
 *   - keeps the page file at "import + dispatch" — no business logic
 *   - lets future per-hub bits (widget catalogs, page-slot resolvers)
 *     live alongside without bloating the route layer
 *   - one place to grep when adding a hub
 */

import { DashboardPage } from "@/features/dashboard";
import { QaPlaceholder } from "@/hubs/qa";

/**
 * Map of hubId → React component for the dashboard slot.
 * Add a new entry when scaffolding a new hub's dashboard.
 */
const DASHBOARDS = {
  dev: DashboardPage,
  qa: () => <QaPlaceholder slot="dashboard" />,
};

/**
 * Generic placeholder for hubs that haven't been scaffolded yet —
 * uses the QA-style "we're still building" shell. Currently never
 * mounted (every hub in the registry has an entry above), but exists
 * so the lookup is total: registering a hub in
 * `@espace-devhub/shared/hubs` without immediately wiring a
 * component here still renders a sensible page.
 */
function DefaultDashboardPlaceholder() {
  return <QaPlaceholder slot="dashboard" />;
}

export function getDashboardComponent(hubId) {
  return DASHBOARDS[hubId] ?? DefaultDashboardPlaceholder;
}
