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

  /**
   * Issue type per key, for keys found in PR titles / branches. One JQL
   * `key in (...)` search per batch instead of one GET per issue — 50 keys
   * is one request. Keys the user can't see (other project, no permission)
   * simply don't come back; the caller treats them as unresolved, never as
   * "not a bug". Returns `{ KEY: "bug" }`, types lower-cased.
   */
  issueTypesForKeys: async (keys) => {
    const clean = (Array.isArray(keys) ? keys : []).filter(
      (k) => typeof k === "string" && /^[A-Z][A-Z0-9]+-\d+$/.test(k),
    );
    if (clean.length === 0) return {};
    const res = await proxyFetch("jira", "search/jql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jql: `key in (${clean.join(",")})`,
        fields: ["issuetype"],
        maxResults: Math.min(100, clean.length),
      }),
    });
    const out = {};
    for (const issue of Array.isArray(res?.issues) ? res.issues : []) {
      const name = issue?.fields?.issuetype?.name;
      if (issue?.key && typeof name === "string") out[issue.key] = name.trim().toLowerCase();
    }
    return out;
  },
};
