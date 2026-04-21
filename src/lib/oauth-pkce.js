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

export async function startGitLabOAuth() {
  const gitlabUrl = process.env.NEXT_PUBLIC_GITLAB_URL;
  const clientId = process.env.NEXT_PUBLIC_GITLAB_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  if (!gitlabUrl || !clientId) {
    throw new Error("GitLab OAuth env vars not configured (NEXT_PUBLIC_GITLAB_URL, NEXT_PUBLIC_GITLAB_CLIENT_ID)");
  }

  const codeVerifier = randomString(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const state = randomString(24);
  stashPending("gitlab", { codeVerifier, state });

  const redirectUri = `${appUrl}/oauth/gitlab`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope: "read_api read_user read_repository",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${gitlabUrl.replace(/\/$/, "")}/oauth/authorize?${params}`;
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
