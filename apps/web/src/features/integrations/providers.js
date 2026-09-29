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
    authMode: "token", // identity + secret (Basic)
    // The form and the copy flip together on engagement: eSpace runs
    // Jira Server 8.x (username + password), Crealogix is Jira Cloud
    // (Atlassian email + API token). `descriptionFor(engagement)` is
    // what the UI should render; `description` is the neutral fallback.
    description: "Connect your Jira account so ticket widgets can read your issues.",
    descriptionByEngagement: {
      espace:
        "Sign in with your Jira Server username and password — the same ones you use in the Jira web UI.",
      crealogix:
        "Sign in with your Atlassian email and an API token from id.atlassian.com → Security → API tokens.",
    },
    scopes: "your own Jira permissions (read-only use)",
    endpointHint: (url) => (url ? url.replace(/^https?:\/\//, "") : "your Jira workspace"),
  },
  gitlab: {
    id: "gitlab",
    label: "GitLab",
    glyph: "GL",
    authMode: "pat", // single Bearer token
    description:
      "Paste a GitLab personal access token. Create one under User settings → Access tokens.",
    // ONE scope list — the card, the form hint and the deep link into
    // GitLab's token page all read from here.
    scopeList: ["read_api", "read_user", "read_repository"],
    scopes: "read_api · read_user · read_repository",
    endpointHint: (url) => (url ? url.replace(/^https?:\/\//, "") : "your GitLab instance"),
    /** Deep link that pre-fills the token name + scopes on the user's GitLab. */
    tokenPageUrl: (baseUrl) =>
      baseUrl
        ? `${baseUrl.replace(/\/$/, "")}/-/user_settings/personal_access_tokens?name=eSpace%20Hubs&scopes=read_api,read_user,read_repository`
        : null,
  },
  github: {
    id: "github",
    label: "GitHub",
    glyph: "GH",
    authMode: "oauth",
    description:
      "Authorise with GitHub. We ask for the repo scope because GitHub has no read-only scope that covers private repositories; we only ever read.",
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
  // NOTE: no Zoho entry. A "Zoho People" OAuth provider used to be
  // advertised here with no api-client, no OAuth route, and no proxy
  // support behind it — a promise the product visibly couldn't keep.
  // Goals arrive via the manual CSV/XLS import (features/goals) until
  // the real M9 Zoho integration lands; re-add the provider WITH its
  // client when that ships.
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/** Engagement-aware description — falls back to the neutral one. */
export function providerDescription(provider, engagement) {
  if (!provider) return "";
  return (
    provider.descriptionByEngagement?.[engagement ?? "espace"] ??
    provider.description
  );
}
