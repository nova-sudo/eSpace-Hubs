"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  fetchIntegrations,
  getIntegrationsServerSnapshot,
  getIntegrationsSnapshot,
  getIntegrationsState,
  readIntegrations,
  subscribeIntegrations,
} from "./integrations-store";
import { useSession } from "@/features/auth";

/**
 * Shared hydration primitive — subscribe to the API-direct store's
 * monotonic tick and kick off a one-shot GET on session establishment.
 * Returns the tick so callers can use it as a memo dep. Idempotent:
 * concurrent consumers share the in-flight promise inside
 * fetchIntegrations().
 */
function useIntegrationsStore() {
  const tick = useSyncExternalStore(
    subscribeIntegrations,
    getIntegrationsSnapshot,
    getIntegrationsServerSnapshot,
  );
  const { user, loading: sessionLoading } = useSession();
  useEffect(() => {
    if (sessionLoading || !user) return;
    const s = getIntegrationsState();
    if (s.fetched || s.loading) return;
    void fetchIntegrations();
  }, [user, sessionLoading]);
  return tick;
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
 * Subscribes to the integrations store, hydrating it from the API on
 * session establishment. Returns:
 *   - `integrations`: full { providerId → entry } record
 *   - `isConnected(providerId)`: boolean (server says a token is on file)
 *   - `connectedProviders`: provider ids currently connected
 *   - `me`: best-effort identity aggregated across providers (header chip)
 *
 * Connection state is driven by the server's `connected` flag, not the
 * presence of token bytes — the store never holds plaintext tokens.
 */
export function useIntegrations() {
  const tick = useIntegrationsStore();
  // readIntegrations() returns the live byProvider reference; it only
  // changes identity when the store replaces it, which also bumps tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const integrations = useMemo(() => readIntegrations(), [tick]);

  const connectedProviders = useMemo(
    () => Object.keys(integrations).filter((id) => integrations[id]?.connected),
    [integrations],
  );

  const me = useMemo(() => {
    const meName =
      integrations.jira?.displayName ||
      integrations.gitlab?.displayName ||
      integrations.github?.displayName ||
      integrations.jira?.username ||
      integrations.gitlab?.username ||
      integrations.github?.username;
    if (!meName) return null;
    return {
      name: meName,
      handle:
        integrations.gitlab?.username ||
        integrations.github?.username ||
        integrations.jira?.username,
      initials: initialsOf(meName),
      team: integrations.jira?.team ?? null,
    };
  }, [integrations]);

  // Expose the store's own fetch lifecycle so callers can distinguish
  // "not yet fetched" from "genuinely disconnected". tick changes
  // whenever the store emits, so this read is always current.
  const { loading: integrationsLoading } = getIntegrationsState();

  return {
    integrations,
    connectedProviders,
    me,
    isConnected: (id) => Boolean(integrations[id]?.connected),
    integrationsLoading,
  };
}
