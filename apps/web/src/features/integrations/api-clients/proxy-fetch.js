import { readIntegrations } from "../integrations-store";

/**
 * Browser → Next.js proxy fetcher.
 *
 * Tokens live in localStorage; we attach them to a request to our own
 * `/api/{provider}/*` route, which forwards upstream. This dodges CORS on
 * self-hosted GitLab and Jira Cloud, and keeps the Next.js server stateless.
 */
export async function proxyFetch(providerId, path, init = {}) {
  const creds = readIntegrations()[providerId];
  if (!creds) throw new Error(`Not connected to ${providerId}`);

  const headers = new Headers(init.headers || {});
  headers.set("x-devhub-provider", providerId);
  if (creds.accessToken) headers.set("x-devhub-token", creds.accessToken);
  if (creds.apiToken) {
    headers.set("x-devhub-api-token", creds.apiToken);
    if (creds.email) headers.set("x-devhub-email", creds.email);
  }

  const res = await fetch(`/api/${providerId}/${path.replace(/^\//, "")}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${providerId} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
