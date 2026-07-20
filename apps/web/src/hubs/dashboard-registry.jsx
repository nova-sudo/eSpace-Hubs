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

import { IntelligencePage } from "@/features/intelligence";
import { QaDashboard, QaPlaceholder } from "@/hubs/qa";
import {
  AdminAudit,
  AdminDashboard,
  AdminHubConfig,
  AdminUsers,
} from "@/hubs/admin";
import {
  ManagerDashboard,
  ManagerEmployees,
  ManagerDelegated,
} from "@/hubs/manager";

/**
 * Map of hubId → React component for the dashboard slot.
 * Add a new entry when scaffolding a new hub's dashboard.
 */
const DASHBOARDS = {
  // Dev's home is the Goal Intelligence Hub (replaced the perf bento in
  // the Sprint-1 revamp). The old DashboardPage slice still exists and is
  // scheduled for retirement in Sprint 4.
  dev: IntelligencePage,
  qa: QaDashboard,
  admin: AdminDashboard,
  manager: ManagerDashboard,
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

/**
 * Admin-specific page-slot resolver. The admin hub uses unique slot
 * ids (hub-config, users, audit) that don't exist in other hubs.
 * Pages files for those slots dispatch through this map.
 *
 * Other hubs keep their per-slot page wiring inline in the route
 * files (e.g. app/[hub]/reviews/page.jsx hard-codes PrReviewsPage).
 * The admin hub uses a registry pattern because it has more slots
 * and benefits from a single dispatch table.
 */
const ADMIN_SLOT_COMPONENTS = {
  "hub-config": AdminHubConfig,
  users: AdminUsers,
  audit: AdminAudit,
};

export function getAdminSlotComponent(slot) {
  return ADMIN_SLOT_COMPONENTS[slot] ?? null;
}

/**
 * Manager-specific page-slot resolver. Mirrors the admin one — the
 * manager hub's `employees` slot has no counterpart in other hubs, so
 * its route file (app/[hub]/employees/page.jsx) dispatches through this
 * map. `employees` renders the report roster; each row opens a report's
 * board at /[hub]/employees/:userId.
 */
const MANAGER_SLOT_COMPONENTS = {
  employees: ManagerEmployees,
  delegated: ManagerDelegated,
};

export function getManagerSlotComponent(slot) {
  return MANAGER_SLOT_COMPONENTS[slot] ?? null;
}
