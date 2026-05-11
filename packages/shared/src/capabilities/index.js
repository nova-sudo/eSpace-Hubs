/**
 * Public API for the capability/role layer.
 *
 *   import { ROLES, CAPABILITIES, resolveCapabilities, hasCapabilities }
 *     from "@espace-devhub/shared/capabilities";
 */

export { CAPABILITIES, ALL_CAPABILITIES } from "./capabilities.js";
export {
  ROLES,
  ALL_ROLES,
  ROLE_CAPABILITIES,
  resolveCapabilities,
  hasCapabilities,
} from "./roles.js";
