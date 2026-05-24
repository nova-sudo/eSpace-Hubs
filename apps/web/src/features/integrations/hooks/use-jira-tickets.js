"use client";

import { jiraApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";

export function useJiraTickets() {
  const { isConnected } = useIntegrations();
  return useSwrIf(
    isConnected("jira"),
    "jira:my-issues",
    () => jiraApi.myIssues(),
  );
}
