"use client";

/**
 * React context exposing the ACTIVE hub for the current page.
 *
 * Set by <HubProvider /> inside app/[hub]/layout.jsx; consumed by
 * - The header (nav links use the active hub's prefix)
 * - Hub-specific pages that need theme / allowedIntegrations / etc.
 *
 * Different from useAvailableHubs():
 *   useActiveHub()       → the ONE hub for the current URL
 *   useAvailableHubs()   → ALL hubs the user can access (for switcher)
 */

import { createContext, useContext } from "react";

/** @type {React.Context<import("@espace-devhub/shared/hubs").HubDefinition | null>} */
export const HubContext = createContext(null);

export function useActiveHub() {
  return useContext(HubContext);
}

/**
 * Strict variant — throws if no hub is active. Use inside components
 * that ONLY render under app/[hub]/... so the absence of a hub
 * indicates a wiring bug rather than a top-level page.
 */
export function useActiveHubStrict() {
  const hub = useContext(HubContext);
  if (!hub) {
    throw new Error(
      "useActiveHubStrict: no active hub. Component must be rendered under <HubProvider /> (app/[hub]/layout.jsx).",
    );
  }
  return hub;
}
