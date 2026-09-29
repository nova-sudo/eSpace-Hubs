"use client";

import { useMemo } from "react";
import { useIntegrations } from "../use-integrations";

/**
 * What the "check at the source" links need from the connected providers:
 * the user's login on each host (to scope a search to them) and, for the
 * self-hosted ones, the host itself. Usernames come from the integrations
 * rows; hosts from the public env the settings page already uses.
 */
const GITLAB_URL = process.env.NEXT_PUBLIC_GITLAB_URL || null;
const JIRA_URL = process.env.NEXT_PUBLIC_JIRA_URL || null;

export function useProviderLinks() {
  const { integrations, isConnected } = useIntegrations();
  return useMemo(
    () => ({
      github: { connected: isConnected("github"), username: integrations.github?.username || null },
      gitlab: { connected: isConnected("gitlab"), username: integrations.gitlab?.username || null, baseUrl: GITLAB_URL },
      jira: { connected: isConnected("jira"), baseUrl: JIRA_URL },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [integrations],
  );
}
