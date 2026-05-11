/**
 * Public API for the frontend hubs feature.
 *
 *   <HubsFetcher />            mount once at root layout; fetches
 *                               /api/v1/hubs/me on session start.
 *   <HubProvider hubSlug={…}>  wraps app/[hub]/layout.jsx; validates
 *                               the URL slug + applies theme.
 *   <HubRedirect />            mount at /page.jsx; dispatches based
 *                               on the user's allowed-hubs count.
 *   <HubPicker hubs primaryHubId />
 *                              full-bleed cards for multi-hub users.
 *                               Mounted by HubRedirect.
 *   <HubSwitcher />            header dropdown to swap hubs mid-session.
 *
 *   useAvailableHubs()          reactive — { status, hubs, primaryHubId, … }
 *   useActiveHub()              the hub for the current URL, or null
 *   useActiveHubStrict()        same, throws if missing (hub-page-only)
 *   getValidPick / setActivePick / clearActivePick
 *                              imperative access to the localStorage
 *                              pick store (used by HubRedirect +
 *                              HubSwitcher).
 */

export { HubsFetcher } from "./hubs-fetcher.jsx";
export { HubProvider } from "./hub-provider.jsx";
export { HubRedirect } from "./hub-redirect.jsx";
export { HubPicker } from "./hub-picker.jsx";
export { HubSwitcher } from "./hub-switcher.jsx";
export { useAvailableHubs } from "./use-available-hubs.js";
export { useActiveHub, useActiveHubStrict, HubContext } from "./hub-context.js";
export { useHubLink } from "./use-hub-link.js";
export { useHubSlotGuard } from "./use-hub-slot-guard.js";
export { useAllowedProviders } from "./use-allowed-providers.js";
export { resetHubsStore } from "./hubs-store.js";
export {
  getActivePick,
  getValidPick,
  setActivePick,
  clearActivePick,
  HUB_PICK_KEY,
} from "./hub-pick-store.js";
