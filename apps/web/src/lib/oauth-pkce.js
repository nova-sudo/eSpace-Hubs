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

export async function startGitHubOAuth() {
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  if (!clientId) {
    throw new Error("GitHub OAuth env var not configured (NEXT_PUBLIC_GITHUB_CLIENT_ID)");
  }

  const state = randomString(24);
  stashPending("github", { state });

  const redirectUri = `${appUrl}/oauth/github`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user repo",
    state,
    allow_signup: "false",
  });
  window.location.href = `https://github.com/login/oauth/authorize?${params}`;
}
