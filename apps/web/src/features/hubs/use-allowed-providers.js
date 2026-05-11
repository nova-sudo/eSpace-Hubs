"use client";

/**
 * Returns the providers the ACTIVE hub allows, in registry order.
 *
 * Source: the active hub's `allowedIntegrations` array (from the
 * shared registry). Cross-references the local PROVIDERS catalog so
 * unknown ids on the registry side are filtered out silently — a
 * hub registry entry that names a provider we haven't shipped yet
 * doesn't leave a hole in the UI.
 *
 * When no hub is active (very brief loading window or a non-hub
 * page somehow renders a hub-aware component), the helper returns
 * ALL providers — the safe, backwards-compatible default that
 * matches the pre-M10.4 behaviour.
 */

import { useMemo } from "react";
import { PROVIDERS, PROVIDER_IDS } from "@/features/integrations";
import { useActiveHub } from "./hub-context.js";

export function useAllowedProviders() {
  const hub = useActiveHub();
  return useMemo(() => {
    if (!hub) return PROVIDER_IDS.map((id) => PROVIDERS[id]).filter(Boolean);
    const allowedSet = new Set(hub.allowedIntegrations || []);
    return PROVIDER_IDS.filter((id) => allowedSet.has(id))
      .map((id) => PROVIDERS[id])
      .filter(Boolean);
  }, [hub]);
}
