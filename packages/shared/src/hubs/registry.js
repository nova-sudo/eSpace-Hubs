/**
 * Hub registry — single source of truth for what hubs exist, what
 * each one is capable of, and which departments map to it.
 *
 * Design contract (M10.1):
 *   - Hubs are DATA, not modules. Adding a hub later is one entry
 *     here + a folder under apps/web/src/hubs/<id>/ (M10.3+). Pages
 *     and widgets reference symbolic ids the rest of the app resolves
 *     to React components.
 *   - The shape is forward-compatible with admin overrides (M10.5):
 *     a future hub_configs Mongo collection holds per-(orgId, hubId)
 *     toggles that merge on top of these defaults at request time.
 *   - Everything here is pure data — no React, no Node-only APIs.
 *     Same import works in apps/web (JS, browser) and apps/api (TS,
 *     server).
 *
 * Currently two hubs:
 *   dev  — Engineering performance & evidence tracking. The hub the
 *          entire app started as.
 *   qa   — QA performance & defect tracking. Scaffolded only at
 *          M10.1; widgets land in M10.3.
 *
 * Adding a hub: append to HUBS below, add departments → hubId
 * mappings, drop a folder under apps/web/src/hubs/<id>/. Onboarding
 * (M-OB) reads `departments` to route the user.
 */

// ─── shapes ──────────────────────────────────────────────────────────

/**
 * Hub-level theme overrides. Hub layout merges these on top of the
 * base CSS variables so each hub gets its own palette without a
 * stylesheet swap. Only the variables a hub actually needs to
 * override appear — the rest inherit.
 */
function freezeTheme(t) {
  return Object.freeze({ ...t });
}

/** Catalog of currently-supported integration provider ids. */
export const ALL_PROVIDERS = Object.freeze(["github", "gitlab", "jira"]);

/**
 * Page slot ids the hub layout can render. Each hub picks which
 * slots it exposes and which component each maps to (resolved by
 * apps/web at render time). The slot ids stay stable across hubs
 * so a department-agnostic widget (e.g. snapshot list) can be
 * routed to the same slot in any hub.
 */
export const PAGE_SLOTS = Object.freeze([
  "dashboard",
  "goals",
  "evidence",
  "snapshots",
  "reviews",
  "settings",
  "analyst",
]);

// ─── hub definitions ─────────────────────────────────────────────────

const DEV_HUB = Object.freeze({
  id: "dev",
  label: "Dev Hub",
  description: "Engineering performance & evidence tracking.",
  theme: freezeTheme({
    primary: "#0a7a5a",
    accent: "#0a7a5a",
    accentSurface: "rgba(10,122,90,0.08)",
  }),
  /** Integrations the hub UI exposes in Settings. */
  allowedIntegrations: Object.freeze(["github", "gitlab", "jira"]),
  /**
   * Pages this hub mounts under /<hubId>/. The values are symbolic
   * — apps/web resolves "dashboard" to the right component at render
   * time. Setting a value to `null` means "this hub doesn't expose
   * that slot".
   */
  pages: Object.freeze({
    dashboard: "dev:dashboard",
    goals: "dev:goals",
    evidence: "dev:evidence",
    snapshots: "dev:snapshots",
    reviews: "dev:reviews",
    settings: "dev:settings",
    analyst: "dev:analyst",
  }),
  /** Widget catalogue this hub's dashboard can mount. */
  widgets: Object.freeze([
    "pr-rounds",
    "cycle-time",
    "merged-count",
    "review-turnaround",
    "linkage",
    "ticket-cycle",
    "code-rubric",
  ]),
  /**
   * Department strings (case-insensitive, normalised at lookup) that
   * route to this hub on first-login onboarding. M-OB reads this.
   */
  departments: Object.freeze([
    "engineering",
    "platform",
    "backend",
    "frontend",
    "mobile",
    "devops",
    "sre",
  ]),
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
  allowedIntegrations: Object.freeze(["gitlab", "jira"]),
  // Pages are stubbed; M10.3 wires the real QA pages. The dashboard
  // slot is present so onboarding routing has a valid landing target
  // for QA users from day one.
  pages: Object.freeze({
    dashboard: "qa:dashboard",
    goals: "qa:goals",
    evidence: "qa:evidence",
    settings: "qa:settings",
  }),
  widgets: Object.freeze([
    // Placeholders — real QA widgets land in M10.3.
    "defect-leakage",
    "test-cycle-time",
    "regression-rate",
  ]),
  departments: Object.freeze([
    "qa",
    "quality assurance",
    "testing",
    "quality",
  ]),
});

/**
 * The canonical registry. Indexed by id for O(1) lookup; iterate
 * via Object.values(HUBS) when you need every hub.
 */
export const HUBS = Object.freeze({
  [DEV_HUB.id]: DEV_HUB,
  [QA_HUB.id]: QA_HUB,
});

/** Stable order for any list UI (header switcher, admin page). */
export const HUB_ORDER = Object.freeze([DEV_HUB.id, QA_HUB.id]);

/** The hub onboarding routes to when no department mapping matches. */
export const DEFAULT_HUB_ID = DEV_HUB.id;

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * Look up a hub by id. Returns null when no match — callers should
 * check rather than assume so an unknown id (e.g. a stale URL) doesn't
 * crash the layout.
 */
export function findHubById(id) {
  if (typeof id !== "string") return null;
  return HUBS[id] ?? null;
}

/**
 * Map a department string (any case, any whitespace) to the matching
 * hub id. Returns the DEFAULT_HUB_ID when nothing matches — onboarding
 * (M-OB) calls this to pick where a new user lands. Returns null when
 * `department` is empty/missing so the caller can prompt instead of
 * silently routing to dev.
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
 * their `allowedHubs` array. Unknown ids are filtered out silently so
 * an admin removing a hub doesn't leave users staring at a broken
 * switcher. Preserves HUB_ORDER.
 */
export function resolveAllowedHubs(allowedHubIds) {
  if (!Array.isArray(allowedHubIds)) return [];
  const set = new Set(allowedHubIds);
  return HUB_ORDER.filter((id) => set.has(id))
    .map((id) => HUBS[id])
    .filter(Boolean);
}
