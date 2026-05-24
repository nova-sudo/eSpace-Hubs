"use client";

import { useSyncExternalStore } from "react";
import { readIntegrations, INTEGRATIONS_CHANGE_EVENT } from "./integrations-store";

function subscribe(callback) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener(INTEGRATIONS_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(INTEGRATIONS_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot() {
  return JSON.stringify(readIntegrations());
}
function getServerSnapshot() {
  return "{}";
}

function initialsOf(name) {
  if (!name) return "";
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Subscribes to the integrations store. Returns:
 *   - `integrations`: full record
 *   - `isConnected(providerId)`: boolean
 *   - `connectedProviders`: provider ids currently connected
 *   - `me`: best-effort identity aggregated across providers (for the header)
 */
export function useIntegrations() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const integrations = JSON.parse(raw);

  const connectedProviders = Object.keys(integrations).filter(
    (id) => integrations[id]?.accessToken || integrations[id]?.apiToken,
  );

  const meName =
    integrations.jira?.displayName ||
    integrations.gitlab?.displayName ||
    integrations.github?.displayName ||
    integrations.jira?.username ||
    integrations.gitlab?.username ||
    integrations.github?.username;

  const me = meName
    ? {
        name: meName,
        handle:
          integrations.gitlab?.username ||
          integrations.github?.username ||
          integrations.jira?.username,
        initials: initialsOf(meName),
        team: integrations.jira?.team ?? null,
      }
    : null;

  return {
    integrations,
    connectedProviders,
    me,
    isConnected: (id) =>
      Boolean(integrations[id]?.accessToken || integrations[id]?.apiToken),
  };
}
