import { readIntegrations } from "./integrations";

async function proxyFetch(provider, path, init = {}) {
  const all = readIntegrations();
  const creds = all[provider];
  if (!creds) throw new Error(`Not connected to ${provider}`);

  const headers = new Headers(init.headers || {});
  headers.set("x-devhub-provider", provider);
  if (creds.accessToken) headers.set("x-devhub-token", creds.accessToken);
  if (creds.apiToken) {
    headers.set("x-devhub-api-token", creds.apiToken);
    if (creds.email) headers.set("x-devhub-email", creds.email);
  }

  const res = await fetch(`/api/${provider}/${path.replace(/^\//, "")}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${provider} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export const jiraApi = {
  myself: () => proxyFetch("jira", "myself"),
  myIssues: (jql = "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC") =>
    proxyFetch("jira", `search?jql=${encodeURIComponent(jql)}&maxResults=50`),
};

export const gitlabApi = {
  me: () => proxyFetch("gitlab", "user"),
  myMergeRequests: (scope = "created_by_me") =>
    proxyFetch("gitlab", `merge_requests?scope=${scope}&state=opened&per_page=50`),
  reviewRequests: () =>
    proxyFetch("gitlab", "merge_requests?scope=assigned_to_me&state=opened&per_page=50"),
};

export const githubApi = {
  me: () => proxyFetch("github", "user"),
  myPulls: () =>
    proxyFetch(
      "github",
      "search/issues?q=" + encodeURIComponent("is:pr author:@me state:open"),
    ),
  reviewRequests: () =>
    proxyFetch(
      "github",
      "search/issues?q=" + encodeURIComponent("is:pr review-requested:@me state:open"),
    ),
};
