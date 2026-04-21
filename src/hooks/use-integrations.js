"use client";

import { useSyncExternalStore } from "react";
import { readIntegrations } from "@/lib/integrations";

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener("integrations:change", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("integrations:change", handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot() {
  return JSON.stringify(readIntegrations());
}

function getServerSnapshot() {
  return "{}";
}

export function useIntegrations() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const integrations = JSON.parse(raw);
  return {
    integrations,
    isConnected: (p) => Boolean(integrations[p]?.accessToken || integrations[p]?.apiToken),
    connectedProviders: Object.keys(integrations).filter(
      (p) => integrations[p]?.accessToken || integrations[p]?.apiToken,
    ),
  };
}
