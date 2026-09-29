/**
 * Turn a failed provider call into guidance a person can act on.
 *
 * Inputs are either the Error thrown by `proxyFetch` (carries
 * `status`, `code`, `provider`, `detail`) or the `{code, message}`
 * envelope the API client returns from `saveConnection`. Output is a
 * short sentence — no status-line prefixes, no HTML, no "fetch failed".
 *
 * Codes come from apps/api/src/modules/integrations/proxy.ts:
 *   integration_not_connected   401  no token on file
 *   integration_misconfigured   401/400  token/URL fails validation
 *   integration_timeout         504
 *   integration_unreachable     502  network-layer failure upstream
 *   integration_upstream_blocked 400  endpoint resolves to a private IP
 *   companion_unreachable       502  paired companion is offline
 * Anything else with a status is an upstream (GitHub/GitLab/Jira/
 * Jenkins) HTTP status passed straight through.
 */

const SCOPE_HINTS = {
  gitlab: "read_api, read_user and read_repository",
  github: "repo and read:user",
  jira: "your own Jira permissions",
  jenkins: "Overall/Read and Job/Read",
};

function hostOf(url) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return String(url).replace(/^https?:\/\//, "");
  }
}

/**
 * @param {unknown} err
 * @param {{ provider?: string, label?: string, url?: string }} [ctx]
 * @returns {string}
 */
export function describeConnectionError(err, ctx = {}) {
  const provider = ctx.provider || err?.provider || "";
  const label = ctx.label || provider || "the provider";
  const host = hostOf(ctx.url);
  const where = host ? `${label} at ${host}` : label;
  const scopes = SCOPE_HINTS[provider] || "the scopes listed above";

  const code = err?.code || err?.error?.code || null;
  const status = typeof err?.status === "number" ? err.status : null;
  const rawMessage = err?.message || err?.error?.message || "";

  switch (code) {
    case "integration_not_connected":
      return `${label} isn't connected yet — the credential didn't reach the server. Try saving again.`;
    case "integration_misconfigured":
      return stripPrefix(rawMessage, provider) || `${label} is missing a URL or credential. Check the form and try again.`;
    case "integration_timeout":
      return `${where} timed out. Try again in a moment, or check the VPN if it's self-hosted.`;
    case "integration_unreachable":
      return `Couldn't reach ${where} — check the URL, and the VPN if it's on a private network.`;
    case "integration_upstream_blocked":
      // The server's message is the accurate one here (private-network
      // policy + the companion alternative). Keep it.
      return stripPrefix(rawMessage, provider);
    case "companion_unreachable":
      return "Your companion app is offline — open it on your laptop and try again.";
    case "network_error":
      return "Couldn't reach the server. Check your connection and try again.";
    case "unauthenticated":
    case "totp_required":
      return "Your session expired. Sign in again and retry.";
    case "rate_limited":
      return `${label} is rate-limiting requests. Wait a minute and try again.`;
    default:
      break;
  }

  switch (status) {
    case 401:
      return `${label} rejected the credential — it's invalid, expired, or missing a scope (needs ${scopes}).`;
    case 403:
      return `${label} accepted the credential but refused the request — usually a missing scope (needs ${scopes}) or a blocked account.`;
    case 404:
      return `${where} answered "not found" — the base URL is probably wrong.`;
    case 429:
      return `${label} is rate-limiting requests. Wait a minute and try again.`;
    case 502:
    case 503:
      return `${where} is unavailable right now. Try again shortly.`;
    case 504:
      return `${where} timed out. Try again in a moment.`;
    default:
      break;
  }

  const detail = stripPrefix(err?.detail || rawMessage, provider);
  if (!detail || /fetch failed|failed to fetch/i.test(detail)) {
    return `Couldn't reach ${where}. Check the URL and your connection, then try again.`;
  }
  return detail;
}

/** Drop the "<provider> <status>: " prefix proxyFetch prepends. */
function stripPrefix(message, provider) {
  if (!message) return "";
  let out = String(message);
  if (provider) {
    out = out.replace(new RegExp(`^${provider}\\s+\\d{3}:?\\s*`, "i"), "");
  }
  return out.trim();
}
