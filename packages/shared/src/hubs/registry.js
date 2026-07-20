/**
 * Hub registry — single source of truth for what hubs exist, what
 * each one is capable of, which departments map to it, and which
 * capabilities are required to access it.
 *
 * Design contract:
 *   - Hubs are DATA, not modules. Adding a hub = one entry here +
 *     a folder under apps/web/src/hubs/<id>/. Pages and widgets
 *     reference symbolic ids the rest of the app resolves to React
 *     components.
 *   - Forward-compatible with admin overrides (M10.5): a future
 *     hub_configs Mongo collection holds per-(orgId, hubId) toggles
 *     that merge on top of these defaults at request time.
 *   - Authorisation lives in the `requires` array — each hub names
 *     the capabilities a user must hold to enter. The orchestrator
 *     computes the user's union-of-capabilities from their roles
 *     and filters this list. See packages/shared/src/capabilities/.
 *   - Everything here is pure data — no React, no Node-only APIs.
 *     Same import works in apps/web and apps/api.
 *
 * Hubs today:
 *   admin    — Admin tools (M10.5 overrides, user management, audit).
 *              Required cap: hub.admin.access (admin role).
 *   dev      — Engineering performance & evidence tracking.
 *              Required cap: hub.dev.access (dev role).
 *   qa       — QA performance & defect tracking (placeholder UI).
 *              Required cap: hub.qa.access (qa role).
 *   manager  — Manager hub with team/employee picker (placeholder UI).
 *              Required cap: hub.manager.access (manager role).
 *
 * Adding a hub:
 *   1. Append to HUBS + HUB_ORDER below
 *   2. Add a capability for hub access in
 *      packages/shared/src/capabilities/capabilities.js
 *   3. Grant the cap from the appropriate role(s) in roles.js
 *   4. Drop a folder under apps/web/src/hubs/<id>/ (+ dashboard-registry)
 *   5. Departments → role(s) mapping in onboarding picks up the rest
 */

import { CAPABILITIES } from "../capabilities/capabilities.js";

// ─── shapes ──────────────────────────────────────────────────────────

function freezeTheme(t) {
  return Object.freeze({ ...t });
}

/** Catalog of currently-supported integration provider ids. */
export const ALL_PROVIDERS = Object.freeze(["github", "gitlab", "jira", "jenkins"]);

/**
 * Page slot ids the hub layout can render. Each hub picks which
 * slots it exposes and which component each maps to.
 */
export const PAGE_SLOTS = Object.freeze([
  "dashboard",
  "goals",
  "evidence",
  "snapshots",
  "reviews",
  "settings",
  "analyst",
  // Admin-specific slots (M10.5 UI lands in PR 2)
  "hub-config",
  "users",
  "audit",
  // Manager-specific (employee picker etc., future)
  "team",
  "employees",
  "delegated",
]);

// ─── hub definitions ─────────────────────────────────────────────────

const ADMIN_HUB = Object.freeze({
  id: "admin",
  label: "Admin",
  description: "Org configuration, user management, audit trail.",
  theme: freezeTheme({
    // Slate/charcoal — visually distinct from Dev's green, QA's
    // orange, Manager's blue. Signals "you're in admin land".
    primary: "#1f2937",
    accent: "#475569",
    accentSurface: "rgba(71,85,105,0.10)",
  }),
  /** Admin hub doesn't surface provider integrations. */
  allowedIntegrations: Object.freeze([]),
  pages: Object.freeze({
    dashboard: "admin:dashboard",
    "hub-config": "admin:hub-config",
    users: "admin:users",
    audit: "admin:audit",
    settings: "admin:settings",
  }),
  widgets: Object.freeze([
    // Admin widgets land alongside the UI in PR 2.
    "org-overview",
    "recent-audit",
    "user-counts",
  ]),
  /** Admins are assigned by role, not department mapping. */
  departments: Object.freeze([]),
  /** Required capabilities to access this hub. */
  requires: Object.freeze([CAPABILITIES.HUB_ADMIN_ACCESS]),
});

const DEV_HUB = Object.freeze({
  id: "dev",
  label: "Dev Hub",
  description: "Engineering performance & evidence tracking.",
  theme: freezeTheme({
    primary: "#0a7a5a",
    accent: "#0a7a5a",
    accentSurface: "rgba(10,122,90,0.08)",
  }),
  allowedIntegrations: Object.freeze(["github", "gitlab", "jira"]),
  pages: Object.freeze({
    dashboard: "dev:dashboard",
    goals: "dev:goals",
    evidence: "dev:evidence",
    snapshots: "dev:snapshots",
    reviews: "dev:reviews",
    settings: "dev:settings",
    analyst: "dev:analyst",
  }),
  widgets: Object.freeze([
    "pr-rounds",
    "cycle-time",
    "merged-count",
    "review-turnaround",
    "linkage",
    "ticket-cycle",
    "code-rubric",
  ]),
  departments: Object.freeze([
    "engineering",
    "platform",
    "backend",
    "frontend",
    "mobile",
    "devops",
    "sre",
  ]),
  requires: Object.freeze([CAPABILITIES.HUB_DEV_ACCESS]),
});

const QA_HUB = Object.freeze({
  id: "qa",
  label: "QA Hub",
  description: "QA performance & defect tracking.",
  theme: freezeTheme({
    primary: "#7a4a0a",
    accent: "#b8722d",
    accentSurface: "rgba(184,114,45,0.08)",
  }),
  allowedIntegrations: Object.freeze(["gitlab", "github", "jira", "jenkins"]),
  pages: Object.freeze({
    dashboard: "qa:dashboard",
    goals: "qa:goals",
    evidence: "qa:evidence",
    settings: "qa:settings",
  }),
  widgets: Object.freeze([
    "defect-leakage",
    "test-cycle-time",
    "regression-rate",
    "build-pass-rate",
  ]),
  departments: Object.freeze([
    "qa",
    "quality assurance",
    "testing",
    "quality",
    "software testing",
  ]),
  requires: Object.freeze([CAPABILITIES.HUB_QA_ACCESS]),
});

const MANAGER_HUB = Object.freeze({
  id: "manager",
  label: "Manager Hub",
  description: "Team-level visibility and employee performance review.",
  theme: freezeTheme({
    // Cool blue/steel — neither green (dev) nor orange (qa).
    primary: "#2c4a73",
    accent: "#3b6aa0",
    accentSurface: "rgba(59,106,160,0.10)",
  }),
  allowedIntegrations: Object.freeze(["gitlab", "jira"]),
  pages: Object.freeze({
    dashboard: "manager:dashboard",
    employees: "manager:employees",
    delegated: "manager:delegated",
    settings: "manager:settings",
  }),
  widgets: Object.freeze([
    "team-overview",
    "employee-list",
    "review-cadence",
  ]),
  departments: Object.freeze([]),
  requires: Object.freeze([CAPABILITIES.HUB_MANAGER_ACCESS]),
});

/**
 * The canonical registry. Indexed by id for O(1) lookup; iterate via
 * Object.values(HUBS) when you need every hub.
 */
export const HUBS = Object.freeze({
  [ADMIN_HUB.id]: ADMIN_HUB,
  [DEV_HUB.id]: DEV_HUB,
  [QA_HUB.id]: QA_HUB,
  [MANAGER_HUB.id]: MANAGER_HUB,
});

/**
 * Stable order for any list UI (header switcher, post-login picker).
 * Admin first so admins see their hub at the top of any picker.
 */
export const HUB_ORDER = Object.freeze([
  ADMIN_HUB.id,
  DEV_HUB.id,
  QA_HUB.id,
  MANAGER_HUB.id,
]);

/** The hub onboarding routes to when no department mapping matches. */
export const DEFAULT_HUB_ID = DEV_HUB.id;

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * Look up a hub by id. Returns null when no match.
 */
export function findHubById(id) {
  if (typeof id !== "string") return null;
  return HUBS[id] ?? null;
}

/**
 * Map a department string (any case, any whitespace) to the matching
 * hub id. Returns null on empty input; DEFAULT_HUB_ID on unknown
 * department (so the caller always has a fallback for non-empty
 * input). Onboarding uses this only as a hint — the real assignment
 * is via `getRolesForDepartment` in apps/api.
 */
export function getHubIdForDepartment(department) {
  if (typeof department !== "string" || department.trim().length === 0) {
    return null;
  }
  const norm = department.trim().toLowerCase();
  for (const hub of Object.values(HUBS)) {
    if (hub.departments.includes(norm)) return hub.id;
  }
  return DEFAULT_HUB_ID;
}

/**
 * Resolve the list of HubDefinition objects a user can access, given
 * their `allowedHubs` array. Unknown ids are filtered out silently.
 * Preserves HUB_ORDER.
 *
 * NOTE: Kept for backward compatibility during the M-CAP migration.
 * The new resolver is `resolveHubsForCapabilities(caps)` below, which
 * is what /api/v1/hubs/me uses post-migration.
 */
export function resolveAllowedHubs(allowedHubIds) {
  if (!Array.isArray(allowedHubIds)) return [];
  const set = new Set(allowedHubIds);
  return HUB_ORDER.filter((id) => set.has(id))
    .map((id) => HUBS[id])
    .filter(Boolean);
}

/**
 * Capability-driven resolver. Given a user's capability set, returns
 * the HubDefinition objects whose `requires` are satisfied. Preserves
 * HUB_ORDER. A hub with no `requires` list is open to everyone (no
 * such hub today; reserved for future public surfaces).
 */
export function resolveHubsForCapabilities(userCapsSet) {
  if (!(userCapsSet instanceof Set)) return [];
  const out = [];
  for (const id of HUB_ORDER) {
    const hub = HUBS[id];
    if (!hub) continue;
    const requires = hub.requires || [];
    let ok = true;
    for (const cap of requires) {
      if (!userCapsSet.has(cap)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(hub);
  }
  return out;
}
