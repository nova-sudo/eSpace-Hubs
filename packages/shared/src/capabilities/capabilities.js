/**
 * Capability vocabulary — single source of truth for what an action
 * in the app "is". Roles GRANT capabilities; hubs (and, in future,
 * individual UI bits) REQUIRE them. The orchestrator computes which
 * hubs a user can access by intersecting their union-of-capabilities
 * with each hub's required-capability list.
 *
 * Adding a new capability:
 *   1. Add it here as a string constant
 *   2. Grant it from some role in roles.js
 *   3. Require it where needed (hubs/registry.js, <RequireCapability>)
 *
 * Capability ids are dotted namespaces — `<scope>.<noun>.<verb>` is
 * the convention (e.g. `admin.users.manage`, `hub.dev.access`).
 * Strings (not symbols) so they survive JSON serialisation in audit
 * rows and admin-config payloads.
 */

export const CAPABILITIES = Object.freeze({
  // ─── Hub access ─────────────────────────────────────────────────
  // One capability per hub. A role that grants `hub.X.access` lets
  // the user enter hub X. Forward-compatible: hr / po hubs reserve
  // their cap ids today so the moment those hubs ship the existing
  // role definitions just work.
  HUB_ADMIN_ACCESS: "hub.admin.access",
  HUB_DEV_ACCESS: "hub.dev.access",
  HUB_QA_ACCESS: "hub.qa.access",
  HUB_MANAGER_ACCESS: "hub.manager.access",
  HUB_HR_ACCESS: "hub.hr.access",
  HUB_PO_ACCESS: "hub.po.access",

  // ─── Admin operations ───────────────────────────────────────────
  // Granular admin verbs. The admin hub UI uses these to gate
  // individual surfaces (sidebar entries, action buttons). One
  // hub.admin.access lets you SEE the admin hub; each verb gates a
  // specific thing INSIDE the hub.
  ADMIN_USERS_MANAGE: "admin.users.manage",
  ADMIN_HUBS_CONFIGURE: "admin.hubs.configure",
  ADMIN_AUDIT_VIEW: "admin.audit.view",

  // ─── Manager operations ─────────────────────────────────────────
  // Reserved for the manager hub's team-view + employee-picker.
  // Real UI lands in a follow-up; capability shipped now so the
  // role definition is complete.
  MANAGER_TEAM_VIEW: "manager.team.view",
});

/**
 * Flat list for iteration / validation. Frozen.
 */
export const ALL_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES));
