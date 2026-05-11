/**
 * Type signatures for the capability vocabulary. Runtime in
 * capabilities.js.
 */

export const CAPABILITIES: Readonly<{
  readonly HUB_ADMIN_ACCESS: "hub.admin.access";
  readonly HUB_DEV_ACCESS: "hub.dev.access";
  readonly HUB_QA_ACCESS: "hub.qa.access";
  readonly HUB_MANAGER_ACCESS: "hub.manager.access";
  readonly HUB_HR_ACCESS: "hub.hr.access";
  readonly HUB_PO_ACCESS: "hub.po.access";
  readonly ADMIN_USERS_MANAGE: "admin.users.manage";
  readonly ADMIN_HUBS_CONFIGURE: "admin.hubs.configure";
  readonly ADMIN_AUDIT_VIEW: "admin.audit.view";
  readonly MANAGER_TEAM_VIEW: "manager.team.view";
}>;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const ALL_CAPABILITIES: readonly Capability[];
