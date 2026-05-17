/**
 * Provider catalog — the single source of truth for "what integrations does this app support".
 *
 * Each provider declares its auth mode and how the settings UI should render it.
 */

export const PROVIDERS = {
  jira: {
    id: "jira",
    label: "Jira",
    glyph: "J",
    authMode: "token", // email + API token (Basic)
    description:
      "Paste a Jira API token. Generate one at id.atlassian.com → Security → API tokens.",
    scopes: "user-scoped API token",
    endpointHint: (url) => (url ? url.replace(/^https?:\/\//, "") : "your Jira workspace"),
  },
  gitlab: {
    id: "gitlab",
    label: "GitLab",
    glyph: "GL",
    authMode: "pat", // single Bearer token
    description:
      "Paste a GitLab Personal Access Token. Create one at User Settings → Access Tokens.",
    scopes: "read_api",
    endpointHint: (url) => (url ? url.replace(/^https?:\/\//, "") : "your GitLab instance"),
  },
  github: {
    id: "github",
    label: "GitHub",
    glyph: "GH",
    authMode: "oauth",
    description: "OAuth into your GitHub account.",
    scopes: "repo · read:user",
    endpointHint: () => "api.github.com",
  },
  jenkins: {
    id: "jenkins",
    label: "Jenkins",
    glyph: "JK",
    // Jenkins uses Basic auth with `username:apiToken` — same shape as
    // Jira, separate authMode so the token form renders the right fields
    // (URL + username + API token, not URL + email + token).
    authMode: "basic",
    description:
      "Paste your Jenkins URL, username, and an API token. Generate one at <your-jenkins>/me/configure → API Token → Add new Token.",
    scopes: "overall/read · job/read · job/build (optional)",
    endpointHint: (url) => (url ? url.replace(/^https?:\/\//, "") : "your Jenkins instance"),
  },
  zoho: {
    id: "zoho",
    label: "Zoho People",
    glyph: "Z",
    authMode: "oauth",
    description:
      "OAuth into Zoho People to pull your L1 / L2 performance goals into the dashboard.",
    scopes: "ZohoPeople.employee.READ · ZohoPeople.forms.READ",
    endpointHint: (dc) => `people.zoho.${dc || "com"}`,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
