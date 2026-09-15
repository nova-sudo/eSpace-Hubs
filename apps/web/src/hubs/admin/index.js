/**
 * Admin Hub public surface. Page components mounted by the
 * dashboard-registry + the slot route files.
 *
 * Each page wraps itself in <AdminShell>, which draws the portal's
 * section rail — that is why the route files stay at "import +
 * dispatch" and no other hub's chrome changes.
 */

export { AdminDashboard } from "./admin-dashboard.jsx";
export { AdminHubConfig } from "./admin-hub-config.jsx";
export { AdminUsers } from "./admin-users.jsx";
export { AdminAudit } from "./admin-audit.jsx";
export { AdminShell } from "./admin-shell.jsx";
