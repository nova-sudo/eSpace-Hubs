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

// useSyncExternalStore compares snapshots by reference (Object.is). A fresh
// object literal per call makes React think the store changed every render and
// warns "The result of getServerSnapshot should be cached to avoid an infinite
// loop." Freeze it once at module scope and return the same reference, so the
// SSR/hydration phase settles deterministically (mirrors auth/use-session.js).
const SERVER_SNAPSHOT = Object.freeze({
  status: "loading",
  hubs: [],
  primaryHubId: null,
  defaultHubId: null,
  error: null,
});

function serverSnapshot() {
  return SERVER_SNAPSHOT;
}

export function useAvailableHubs() {
  return useSyncExternalStore(subscribeHubs, getHubsState, serverSnapshot);
}
