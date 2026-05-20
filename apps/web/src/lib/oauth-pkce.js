/**
 * OAuth start-flow helpers.
 *
 * One file per-provider would be cleaner but each flow is ~20 lines, so they
 * stay here until the count grows. Currently only GitHub uses OAuth; Jira
 * and GitLab use paste-token flows handled directly in their forms.
 */

function base64UrlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Base64Url(input) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

const PENDING_KEY = "espace-devhub:oauth-pending";

export function stashPending(provider, data) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ provider, ...data }));
}

export function readPending() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
  } catch {
    return null;
  }
}

export function clearPending() {
  sessionStorage.removeItem(PENDING_KEY);
}

/**
 * Kick off the GitHub OAuth flow.
 *
 * `clientId` now comes from the per-user engagement-config (resolved
 * by the API from the user's `engagement` field). The caller is
 * expected to read it via `useMyEngagementConfig()` and pass it
 * here — keeping the function pure means it doesn't need a hook
 * dependency in this otherwise-React-free module.
 *
 * Falls back to `NEXT_PUBLIC_GITHUB_CLIENT_ID` (env-baked) only when
 * the runtime config is missing — e.g. older deployments mid-cutover.
 * Once every deployment runs against an engagement-aware API, the
 * fallback can be retired.
 */
export async function startGitHubOAuth({ clientId } = {}) {
  const resolvedClientId =
    clientId || process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  if (!resolvedClientId) {
    throw new Error(
      "GitHub OAuth not configured for this engagement (no githubClientId from /auth/me/engagement-config and no NEXT_PUBLIC_GITHUB_CLIENT_ID fallback).",
    );
  }

  const state = randomString(24);
  stashPending("github", { state });

  const redirectUri = `${appUrl}/oauth/github`;
  const params = new URLSearchParams({
    client_id: resolvedClientId,
    redirect_uri: redirectUri,
    scope: "read:user repo",
    state,
    allow_signup: "false",
  });
  window.location.href = `https://github.com/login/oauth/authorize?${params}`;
}
