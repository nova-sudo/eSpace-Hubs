/**
 * Public API for the shared hub registry.
 *
 *   import { HUBS, findHubById, getHubIdForDepartment }
 *     from "@espace-devhub/shared/hubs";
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
  resolveHubsForCapabilities,
} from "./registry.js";
