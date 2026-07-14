"use client";

/**
 * Thin fetch wrapper for the API service (apps/api on port 4000).
 *
 * Why a wrapper, not raw fetch:
 *   - Always sends the session cookie via `credentials: "include"`,
 *     never depends on the caller remembering.
 *   - Returns a discriminated `{ok, ...}` envelope so callers can
 *     pattern-match without try/catch. Mirror-mode stores will read
 *     `result.ok` to decide whether to fall back to localStorage.
 *   - Maps the API's error envelope ({error: {code, message, details}})
 *     into a predictable shape — same fields whether the failure is
 *     server-side (4xx/5xx) or network-side (status: 0).
 *
 * Base path: `/api/v1`. The Next.js `rewrites()` in next.config.mjs
 * proxies `/api/v1/*` to `http://localhost:4000` in dev, so the
 * browser always sees a same-origin URL. In production this same path
 * lands on the deployed API service through whatever reverse proxy
 * is configured.
 */

import { toast } from "sonner";

const API_BASE = "/api/v1";

/**
 * Phase 3e — surface "companion_unreachable" 502s to the user as a
 * one-shot toast. The catch-all (apps/web/src/pages/api/v1/[...path].ts)
 * emits this code when the user's paired companion fails to answer a
 * proxied request: the tunnel is registered fresh but the local backend
 * is down, the laptop's asleep, the VPN dropped, etc.
 *
 * Throttling: every component that fires a /api/v1/* call would
 * otherwise pile up a toast each. We coalesce inside a 30s window so
 * the user sees one banner, not twenty.
 */
let lastCompanionUnreachableToastAt = 0;
const COMPANION_UNREACHABLE_THROTTLE_MS = 30_000;
function maybeToastCompanionUnreachable(message) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastCompanionUnreachableToastAt < COMPANION_UNREACHABLE_THROTTLE_MS) {
    return;
  }
  lastCompanionUnreachableToastAt = now;
  toast.error("Companion offline", {
    description:
      message ||
      "Couldn't reach your companion. Open the desktop app to resume routing.",
    duration: 8000,
  });
}

/**
 * Pages where a 401 is normal and shouldn't bounce the user back to
 * /login (we're either already on /login, completing an auth flow,
 * or in a known-public surface). Matched as prefix-or-exact paths.
 */
const PUBLIC_AUTH_PATHS = Object.freeze([
  "/", // public marketing landing — RootGate shows it to logged-out
       // visitors, so the /auth/me 401 must NOT bounce them to /login.
       // Exact-match only: "/" never matches "/foo" (startsWith("//")).
  "/login",
  "/signup",
  "/waiting-approval",
  "/forgot-password",
  "/password-reset",
  "/accept-invite",
  "/totp-setup",
  "/oauth/github",
  "/onboarding", // gated on /me itself; let the page handle its own redirect
]);

/**
 * ALLOWLIST: the ONLY 401 error codes that mean "your session is gone,
 * send the user back to /login." Everything else is a 401 from some
 * OTHER source and should NOT trigger a redirect:
 *
 *   - integration_misconfigured  → user's GitHub/GitLab/Jira token is
 *                                   bad. The widget should render a
 *                                   reconnect prompt, not bounce auth.
 *   - http_401 (upstream)        → the integration proxy passed
 *                                   through a 401 from GitHub/GitLab
 *                                   /Jira (their auth, not ours).
 *                                   Same as above.
 *   - totp_required              → partial session waiting for TOTP.
 *                                   Login form swaps to step 2; not
 *                                   a "you're logged out" signal.
 *   - invalid_credentials,
 *     invalid_totp_code          → only emitted on /login, which is
 *                                   already in PUBLIC_AUTH_PATHS, but
 *                                   defensively NOT in the allowlist.
 *
 * Switching from the previous blocklist to this allowlist fixes the
 * infinite loop where landing in a hub fired off integration calls,
 * those returned 401 (no tokens yet), api-client redirected to /login,
 * useSession's /me succeeded (session was fine!), LoginForm saw the
 * authenticated user and bounced back to the hub, which then fired
 * the same integration calls and… loop.
 */
const REDIRECT_401_CODES = Object.freeze(new Set([
  "unauthenticated", // the canonical "no session" signal from requireAuth
]));

/**
 * Module-level flag — without this we'd queue N redirects when the
 * page mounted and N components all fire a 401-able GET in parallel
 * (dashboard tiles, useSession, useEngagementConfig). The first one
 * wins; subsequent 401s during the same tick are no-ops.
 */
let redirectingToLogin = false;

function maybeRedirectToLogin(errorCode) {
  if (typeof window === "undefined") return;
  if (redirectingToLogin) return;
  // Allowlist semantics — anything OTHER than the explicit "session is
  // gone" codes stays on the current page so consumers can render
  // their own "reconnect integration" / "wrong password" UI.
  if (!errorCode || !REDIRECT_401_CODES.has(errorCode)) return;

  const path = window.location.pathname || "/";
  for (const pub of PUBLIC_AUTH_PATHS) {
    if (path === pub || path.startsWith(`${pub}/`)) return;
  }

  redirectingToLogin = true;
  const returnTo = path + (window.location.search || "");
  // Existing /login page reads `?next=...` (see app/login/page.jsx).
  const target =
    returnTo === "/" || returnTo === ""
      ? "/login"
      : `/login?next=${encodeURIComponent(returnTo)}`;
  // Use location.assign (not history.replace) so the back button
  // doesn't bounce the user between the expired page and login.
  window.location.replace(target);
}

/**
 * @typedef {Object} ApiSuccess
 * @property {true} ok
 * @property {number} status
 * @property {any} data
 *
 * @typedef {Object} ApiError
 * @property {false} ok
 * @property {number} status   // 0 for network failures
 * @property {{code: string, message: string, details?: unknown, requestId?: string}} error
 *
 * @typedef {ApiSuccess | ApiError} ApiResult
 */

async function request(method, path, body, init = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(init.headers || {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...init,
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: {
        code: "network_error",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // 204 / empty body — uniform handling.
  const contentType = res.headers.get("content-type") || "";
  let payload;
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    payload = null;
  } else if (contentType.includes("application/json")) {
    try {
      payload = await res.json();
    } catch (err) {
      return {
        ok: false,
        status: res.status,
        error: {
          code: "malformed_response",
          message: `Server returned non-JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  } else {
    // Treat anything non-JSON as opaque — used by the proxy endpoints
    // when they pass through binary or text bodies.
    payload = await res.text();
  }

  if (!res.ok) {
    const apiError =
      payload && typeof payload === "object" && payload.error
        ? payload.error
        : { code: `http_${res.status}`, message: `HTTP ${res.status}` };
    // Global 401 → login redirect (fire-and-forget). Excludes
    // continuation codes like totp_required and skips when we're
    // already on a public auth page. See PUBLIC_AUTH_PATHS above.
    if (res.status === 401) {
      maybeRedirectToLogin(apiError.code);
    }
    // Companion offline (Phase 3e). The catch-all returns 502 with
    // this specific code when proxying to the user's paired
    // companion-tunnel hostname fails. We don't want individual
    // callers to each render their own error — one global toast.
    if (res.status === 502 && apiError.code === "companion_unreachable") {
      maybeToastCompanionUnreachable(apiError.message);
    }
    return { ok: false, status: res.status, error: apiError };
  }

  return { ok: true, status: res.status, data: payload };
}

export const apiGet = (path, init) => request("GET", path, undefined, init);
export const apiPost = (path, body, init) => request("POST", path, body, init);
export const apiPut = (path, body, init) => request("PUT", path, body, init);
export const apiPatch = (path, body, init) => request("PATCH", path, body, init);
export const apiDelete = (path, init) => request("DELETE", path, undefined, init);
