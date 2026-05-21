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

const API_BASE = "/api/v1";

/**
 * Pages where a 401 is normal and shouldn't bounce the user back to
 * /login (we're either already on /login, completing an auth flow,
 * or in a known-public surface). Matched as prefix-or-exact paths.
 */
const PUBLIC_AUTH_PATHS = Object.freeze([
  "/login",
  "/forgot-password",
  "/password-reset",
  "/accept-invite",
  "/totp-setup",
  "/oauth/github",
  "/onboarding", // gated on /me itself; let the page handle its own redirect
]);

/**
 * Some 401s mean "you have a partial session, finish step 2" rather
 * than "your session is gone." Don't redirect on these — the UI is
 * about to ask for a TOTP code or similar continuation.
 */
const NON_REDIRECT_401_CODES = Object.freeze(new Set([
  "totp_required",
  // Add more here if future endpoints use 401 to signal "you need to
  // do X first" rather than "you're not logged in."
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
  if (errorCode && NON_REDIRECT_401_CODES.has(errorCode)) return;

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
    return { ok: false, status: res.status, error: apiError };
  }

  return { ok: true, status: res.status, data: payload };
}

export const apiGet = (path, init) => request("GET", path, undefined, init);
export const apiPost = (path, body, init) => request("POST", path, body, init);
export const apiPut = (path, body, init) => request("PUT", path, body, init);
export const apiPatch = (path, body, init) => request("PATCH", path, body, init);
export const apiDelete = (path, init) => request("DELETE", path, undefined, init);
