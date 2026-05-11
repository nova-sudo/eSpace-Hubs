/**
 * Type barrel for @espace-devhub/shared/hubs.
 */

export {
  ALL_PROVIDERS,
  DEFAULT_HUB_ID,
  HUBS,
  HUB_ORDER,
  PAGE_SLOTS,
  findHubById,
  getHubIdForDepartment,
  resolveAllowedHubs,
} from "./registry.js";

export type {
  HubDefinition,
  HubPageSlot,
  HubTheme,
} from "./registry.js";
