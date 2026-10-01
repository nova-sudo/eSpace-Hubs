/**
 * Which AUTO metrics read the user's Jira issue list (`jira:my-issues`).
 *
 * Pure and dependency-light on purpose so the gate is unit-testable without
 * pulling the widget tree. Only ticket cycle time reads the issue list;
 * TICKET_TYPE_SHARE resolves the types of the keys its PRs reference through
 * `useJiraIssueTypes` (its own batched lookup), and LINKAGE_PCT only
 * regex-matches Jira keys in PR text — neither needs `jira:my-issues`.
 */
import { SOURCE_METRICS } from "@espace-devhub/shared/goal-specs";

export function metricNeedsJiraTickets(metric) {
  return metric === SOURCE_METRICS.TICKET_CYCLE_TIME;
}

/** True when a metric resolves Jira issue types (the batched lookup). */
export function metricNeedsJiraIssueTypes(metric) {
  return metric === SOURCE_METRICS.TICKET_TYPE_SHARE;
}
