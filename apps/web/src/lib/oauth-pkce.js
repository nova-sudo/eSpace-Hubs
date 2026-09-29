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

// One entry PER HANDSHAKE, keyed by its `state` — a single shared key let
// two tabs that both started OAuth overwrite each other, and the first
// callback then reported "didn't match" for a perfectly good flow.
const PENDING_PREFIX = "espace-devhub:oauth-pending:";
// The pre-per-state key; cleared on sight so it can't linger.
const LEGACY_PENDING_KEY = "espace-devhub:oauth-pending";
// A pending handshake older than this is dead — the user wandered off
// and a stale `state` must not be accepted later. GitHub's own
// authorize page expires the code after 10 minutes anyway.
const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * Pending-handshake storage. localStorage, not sessionStorage: the
 * OAuth callback can land in a NEW tab (some browsers / password
 * managers / "open in new tab" on the authorize page), and
 * sessionStorage is per-tab, which made the CSRF check fail with an
 * "OAuth state mismatch" for a perfectly good flow. The `state` still
 * has to match exactly (it IS the key) and the entry expires, so the
 * CSRF property is unchanged.
 *
 * Every access is guarded: Safari private mode, a full quota or blocked
 * site data throw from setItem / removeItem, not just from the accessor.
 */
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeRemove(key) {
  try {
    storage()?.removeItem(key);
  } catch {
    /* nothing to clean up then */
  }
}

/** Drop expired handshakes (and the legacy single-key entry). */
function prunePending(now = Date.now()) {
  const store = storage();
  if (!store) return;
  safeRemove(LEGACY_PENDING_KEY);
  try {
    const keys = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (k && k.startsWith(PENDING_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      let raw = null;
      try {
        raw = JSON.parse(store.getItem(k) || "null");
      } catch {
        raw = null;
      }
      if (!raw || !raw.createdAt || now - raw.createdAt > PENDING_TTL_MS) safeRemove(k);
    }
  } catch {
    /* best effort */
  }
}

/** Store a pending handshake under its `state`. Returns false when storage refused it. */
export function stashPending(provider, data) {
  if (!data?.state) return false;
  prunePending();
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(
      `${PENDING_PREFIX}${data.state}`,
      JSON.stringify({ provider, createdAt: Date.now(), ...data }),
    );
    return true;
  } catch {
    return false;
  }
}

/** The pending handshake for `state`, or null (unknown, expired, unreadable). */
export function readPending(state) {
  if (!state) return null;
  try {
    const raw = JSON.parse(storage()?.getItem(`${PENDING_PREFIX}${state}`) || "null");
    if (!raw) return null;
    if (raw.createdAt && Date.now() - raw.createdAt > PENDING_TTL_MS) {
      clearPending(state);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function clearPending(state) {
  if (state) safeRemove(`${PENDING_PREFIX}${state}`);
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
 *
 * `returnTo` is where the callback sends the user afterwards — the
 * Settings → Integrations tab they started from, by default the current
 * page. Stored alongside `state` so the callback page needs no context.
 *
 * Scope: `repo` + `read:user`. GitHub has no read-only OAuth scope that
 * covers PRIVATE repositories — `public_repo` is public-only — so
 * `repo` is the smallest scope that lets the merged-PR and review
 * widgets see private work. We only ever read with it.
 */
export async function startGitHubOAuth({ clientId, returnTo } = {}) {
  const resolvedClientId =
    clientId || process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  if (!resolvedClientId) {
    throw new Error(
      "GitHub OAuth not configured for this engagement (no githubClientId from /auth/me/engagement-config and no NEXT_PUBLIC_GITHUB_CLIENT_ID fallback).",
    );
  }

  const state = randomString(24);
  const fallbackReturn =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/";
  if (!stashPending("github", { state, returnTo: returnTo || fallbackReturn })) {
    throw new Error(
      "Your browser blocked saving the sign-in handshake (private browsing or full storage). Allow site data for this app and try again.",
    );
  }

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
