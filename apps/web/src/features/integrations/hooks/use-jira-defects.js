"use client";

/**
 * Project-scoped Jira-defect hooks for the QA Hub.
 *
 * Different from `useJiraTickets` (which scopes to the current user
 * across all projects). These hooks fetch:
 *
 *   - "every Bug filed in project X over the last N days"
 *
 * intended for QA-hub widgets that summarise team-wide quality
 * signal, not one person's queue.
 *
 * The project key is passed in by the widget (hard-coded to `ESPQA`
 * in callers for now; PR C makes it a per-org setting under QA Hub
 * config).
 *
 * SWR caching: key is `jira:defects:<projectKey>:<daysBack>` so two
 * widgets querying the same window share a single fetch. The
 * `useJiraTickets` hook has its own `jira:my-issues` key so we
 * never collide with it.
 *
 * Demo-mode short-circuit: the existing demo dataset doesn't include
 * project-keyed tickets (only user-keyed). So in demo mode we return
 * an empty data array — the QA dashboard's defect tiles will read
 * as "0 defects" with the "demo mode is on" caveat surfaced by the
 * dashboard's existing DemoBanner.
 */

import { jiraApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { useDemoMode } from "@/features/demo-mode";

/**
 * @param projectKey  Jira project key, e.g. "ESPQA"
 * @param daysBack    how far back to look (14 by default — matches
 *                     the typical sprint cadence)
 * @returns { data, isLoading, error }
 *           data is the raw Jira search response: { issues: [...], ... }
 *           or undefined while loading
 */
export function useJiraDefectsForProject(projectKey, daysBack = 14) {
  const { isConnected } = useIntegrations();
  const demo = useDemoMode();
  const enabled = !demo && isConnected("jira") && !!projectKey;
  const jql = `project = ${projectKey} AND issuetype = Bug AND created >= -${daysBack}d ORDER BY created DESC`;
  const swr = useSwrIf(
    enabled,
    enabled ? `jira:defects:${projectKey}:${daysBack}` : null,
    () => jiraApi.myIssues(jql),
  );
  if (demo) {
    return { data: { issues: [] }, isLoading: false, error: null };
  }
  return swr;
}
