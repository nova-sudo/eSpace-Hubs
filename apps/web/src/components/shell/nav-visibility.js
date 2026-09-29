/**
 * Slots that stay registered in a hub's `pages` map (so the route still
 * resolves — direct URLs and notification deep-links keep working) but
 * shouldn't clutter that hub's nav bar. Shared by the header (which hides
 * them) and the home sub-nav (drill-down-nav.jsx, which surfaces them as secondary links).
 *
 * Keyed per-hub rather than per-slot because QA has a "dashboard" slot of
 * its own that must keep its entry.
 */
export const HUB_HIDDEN_NAV_SLOTS = Object.freeze({
  // Engineers rarely view someone else's shared goal; the notification that
  // shares one deep-links to /shared-goals, and the home tab's sub-nav
  // lists it, so no permanent nav pill on the busiest hubs.
  dev: ["sharedgoals"],
  qa: ["sharedgoals"],
  // The manager's "Team" tab (dashboard) and "Employees" render the same
  // roster page, so two pills for one page read as two places. Team stays;
  // /employees/:userId (a report's board) keeps working and lights Team —
  // see TAB_ALIASES in header.jsx.
  manager: ["employees"],
});

/**
 * Hidden slots whose pages should light another tab instead. A report's
 * board lives under /employees/:userId but is reached from Team.
 */
export const TAB_ALIASES = Object.freeze({
  manager: { dashboard: ["/employees"] },
});

export function isNavHidden(hubId, slot) {
  return Boolean(HUB_HIDDEN_NAV_SLOTS[hubId]?.includes(slot));
}
