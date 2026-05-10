import { proxyFetch } from "./proxy-fetch";

/**
 * Jira REST v3 client, narrow to what the dashboard actually needs.
 * Each method maps 1:1 to an endpoint — keep these dumb.
 */
export const jiraApi = {
  myself: () => proxyFetch("jira", "myself"),

  /**
   * Uses the new POST /search/jql endpoint (Atlassian deprecated /search in 2025).
   * We explicitly project the fields the UI renders to keep payloads small.
   */
  myIssues: (
    // Include recently-shipped tickets so the "Shipped" column isn't always
    // empty. Window done tickets to the last 90d so it doesn't grow forever.
    jql = 'assignee = currentUser() AND (resolution = Unresolved OR resolutiondate >= -90d) ORDER BY updated DESC',
  ) =>
    proxyFetch("jira", "search/jql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jql,
        fields: [
          "summary",
          "status",
          "priority",
          "issuetype",
          "assignee",
          "updated",
          "duedate",
          "resolutiondate",
        ],
        maxResults: 50,
      }),
    }),
};
