"use client";

/**
 * Hook that returns the user's accessible hubs (from /api/v1/hubs/me).
 *
 * Lifecycle:
 *   - mount → if status==="loading" and we haven't fired yet, fetch.
 *   - auth flips authenticated → loading → fetch.
 *   - auth flips to guest → store reset to loading (handled by the
 *     <HubsFetcher /> mount component in the root layout).
 *
 * Returns:
 *   status         "loading" | "ready" | "error"
 *   hubs           HubDefinition[]   — empty until status==="ready"
 *   primaryHubId   string | null
 *   defaultHubId   string | null
 *   error          {code,message} | null
 */

import { useSyncExternalStore } from "react";
import { getHubsState, subscribeHubs } from "./hubs-store";

function serverSnapshot() {
  return {
    status: "loading",
    hubs: [],
    primaryHubId: null,
    defaultHubId: null,
    error: null,
  };
}

export function useAvailableHubs() {
  return useSyncExternalStore(subscribeHubs, getHubsState, serverSnapshot);
}
