/**
 * @espace-devhub/web — companion feature barrel.
 *
 * UI for the desktop companion-app pairing flow + per-user
 * tunnel-routing surfacing:
 *
 *   CompanionPairForm           /companion/pair approval page contents
 *   CompanionIndicator          header chip showing where /api/v1/* is going
 *   CompanionApiOriginProvider  mount-once driver of the api-origin store
 *   useApiOrigin                reactive hook over the store
 *   refreshApiOrigin            imperative refresh (after pair/unpair)
 *   DevicesList                 /settings/devices contents (Phase 3e)
 *   CompanionSetupGuide         /settings/companion explainer (Phase 3e)
 */

export { CompanionPairForm } from "./companion-pair-form.jsx";
export { CompanionIndicator } from "./companion-indicator.jsx";
export { CompanionApiOriginProvider } from "./companion-api-origin-provider.jsx";
export { useApiOrigin, refreshApiOrigin } from "./use-api-origin.js";
export { DevicesList } from "./devices-list.jsx";
export { CompanionSetupGuide } from "./companion-setup-guide.jsx";
