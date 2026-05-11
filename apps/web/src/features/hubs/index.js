/**
 * Public API for the frontend hubs feature.
 *
 *   <HubsFetcher />            mount once at root layout; fetches
 *                               /api/v1/hubs/me on session start.
 *   <HubProvider hubSlug={…}>  wraps app/[hub]/layout.jsx; validates
 *                               the URL slug + applies theme.
 *   <HubRedirect />            mount at /page.jsx; routes to primary.
 *
 *   useAvailableHubs()         reactive — { status, hubs, primaryHubId, … }
 *   useActiveHub()              the hub for the current URL, or null
 *   useActiveHubStrict()        same, throws if missing (hub-page-only)
 */

export { HubsFetcher } from "./hubs-fetcher.jsx";
export { HubProvider } from "./hub-provider.jsx";
export { HubRedirect } from "./hub-redirect.jsx";
export { useAvailableHubs } from "./use-available-hubs.js";
export { useActiveHub, useActiveHubStrict, HubContext } from "./hub-context.js";
export { useHubLink } from "./use-hub-link.js";
export { useHubSlotGuard } from "./use-hub-slot-guard.js";
export { resetHubsStore } from "./hubs-store.js";
