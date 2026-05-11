/**
 * Hub-config merge layer.
 *
 * Applies per-(orgId, hubId) overrides on top of the shared registry
 * defaults. Pure function — no I/O. Called by the /hubs/me handler
 * after it fetches the raw override rows.
 *
 * Merge rules (also documented in the HubConfig interface):
 *   enabled              when explicitly false → caller filters
 *                        the hub out entirely. true/null/missing
 *                        leave the hub visible.
 *   label, description   nullable scalar overrides; null/missing
 *                        falls through to the registry default.
 *   allowedIntegrations  REPLACES the registry default in full.
 *                        Empty array is meaningful ("no integrations
 *                        for this hub"). null/missing falls through.
 *   pages                PARTIAL merge: only the slot ids present in
 *                        the override are touched. A value of `null`
 *                        on a slot REMOVES it from the effective map
 *                        (hides the page in this hub). Slots not in
 *                        the override pass through from defaults.
 *   departments          REPLACES the registry default in full.
 *                        Department lookup is order-irrelevant so
 *                        partial-merge semantics would be confusing.
 *
 * The function returns a NEW object — never mutates the registry
 * default in place.
 */

import type { HubDefinition } from "@espace-devhub/shared/hubs";
import type { HubConfig } from "../../db/types.js";

export interface HubMergeResult {
  hub: HubDefinition;
  /** False when an override disabled this hub. Callers should drop it. */
  enabled: boolean;
}

export function mergeHubOverride(
  defaultHub: HubDefinition,
  override: HubConfig | null,
): HubMergeResult {
  if (!override) {
    return { hub: defaultHub, enabled: true };
  }

  const enabled = override.enabled === false ? false : true;

  // Pages: partial merge with null-removal semantics.
  let pages: Record<string, string> = { ...defaultHub.pages };
  if (override.pages && typeof override.pages === "object") {
    for (const [slot, value] of Object.entries(override.pages)) {
      if (value === null) {
        delete pages[slot];
      } else if (typeof value === "string" && value.length > 0) {
        pages[slot] = value;
      }
      // Any other value type (undefined/number/etc) is ignored —
      // schema validator rejects them at write time so this branch
      // is defensive.
    }
  }

  const hub: HubDefinition = {
    ...defaultHub,
    label:
      typeof override.label === "string" && override.label.length > 0
        ? override.label
        : defaultHub.label,
    description:
      typeof override.description === "string" && override.description.length > 0
        ? override.description
        : defaultHub.description,
    allowedIntegrations: Array.isArray(override.allowedIntegrations)
      ? override.allowedIntegrations
      : defaultHub.allowedIntegrations,
    pages,
    departments: Array.isArray(override.departments)
      ? override.departments
      : defaultHub.departments,
  };

  return { hub, enabled };
}
