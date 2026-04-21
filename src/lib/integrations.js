export const PROVIDERS = {
  jira: {
    id: "jira",
    label: "Jira",
    authMode: "token",
    description: "Paste a Jira API token. Generate one at id.atlassian.com → Security → API tokens.",
    color: "#0052CC",
  },
  gitlab: {
    id: "gitlab",
    label: "GitLab",
    authMode: "oauth",
    description: "OAuth into your self-hosted GitLab account.",
    color: "#FC6D26",
  },
  github: {
    id: "github",
    label: "GitHub",
    authMode: "oauth",
    description: "OAuth into your GitHub account.",
    color: "#1F2328",
  },
};

const STORAGE_KEY = "espace-devhub:integrations";

export function readIntegrations() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function writeIntegrations(next) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("integrations:change"));
}

export function saveConnection(provider, payload) {
  const all = readIntegrations();
  all[provider] = { ...payload, connectedAt: Date.now() };
  writeIntegrations(all);
}

export function disconnectProvider(provider) {
  const all = readIntegrations();
  delete all[provider];
  writeIntegrations(all);
}

export function isConnected(provider) {
  const all = readIntegrations();
  return Boolean(all[provider]?.accessToken || all[provider]?.apiToken);
}
