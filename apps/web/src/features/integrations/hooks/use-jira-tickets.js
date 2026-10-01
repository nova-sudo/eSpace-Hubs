"use client";

import { jiraApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";

/**
 * The user's Jira issues (`jira:my-issues`). Pass `enabled = false` to skip
 * the request — `useDataSource` does for every metric that doesn't read
 * tickets, so a Jira-connected user with no Jira goal no longer pays one
 * Jira call per page.
 */
export function useJiraTickets(enabled = true) {
  const { isConnected } = useIntegrations();
  return useSwrIf(
    enabled !== false && isConnected("jira"),
    "jira:my-issues",
    () => jiraApi.myIssues(),
  );
}
