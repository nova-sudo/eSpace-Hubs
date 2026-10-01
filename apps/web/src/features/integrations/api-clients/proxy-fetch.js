/**
 * Browser → API service proxy fetcher.
 *
 * Post-M7.9c: hits the API service's encrypted-at-rest proxy
 *   GET /api/v1/integrations/proxy/<providerId>/<rest of path>
 * The API decrypts the user's token in-process (it never touches the
 * browser), forwards to the upstream provider, and streams the
 * response back through an allowlist of safe headers.
 *
 * Auth: the session cookie is sent via `credentials: "include"` (the
 * Next.js rewrite proxies /api/v1/* to localhost:4000 same-origin in
 * dev). The API rejects with 401 unauthenticated/totp_required if
 * the session is missing — those errors bubble up to the caller as
 * thrown Errors, matching the pre-M7.9c contract.
 *
 * Pre-M7.9c shape (deleted): we used to read the plaintext token
 * from localStorage and ship it as `x-devhub-token` to a Next.js
 * proxy route. That pattern defeated the M6 encryption-at-rest
 * design and is now retired.
 *
 * @see {@link "@/lib/rate-limit"} for the retry/backoff primitives.
 *
 * Rate limits: every call runs under the per-provider circuit breaker in
 * `@/lib/rate-limit`. A limited provider fails fast (no request sent),
 * the thrown Error carries `rateLimited: true`, `code: "rate_limited"`,
 * `retryAfterMs` and `rateLimitedUntil`, and SWR keeps serving cached
 * data while the app-level banner explains why.
 *
 * Deadline: the whole call (including the one short rate-limit retry) is
 * bounded by PROXY_DEADLINE_MS. The API's own upstream timeout is 45s;
 * a browser tile has no business spinning that long.
 *
 * 304: returns the NOT_MODIFIED sentinel instead of throwing, so a cache
 * layer that sent a conditional request can reuse its copy. Nothing sends
 * conditional headers yet (the proxy does not forward them), but the
 * contract is in place.
 */
import {
  fetchWithRateLimitRetry,
  detectRateLimit,
  getRateLimit,
} from "@/lib/rate-limit";
import { maybeToastCompanionUnreachable } from "@/lib/api-client";

/** Overall budget for one proxyFetch call. */
export const PROXY_DEADLINE_MS = 25_000;

/** Returned (not thrown) on a 304 — "your cached copy is still good". */
export const NOT_MODIFIED = Symbol.for("espace-devhub.proxy.not-modified");

export function isNotModified(value) {
  return value === NOT_MODIFIED;
}

/** Which GitHub budget a path draws from (search and core are separate pools). */
export function githubBucketForPath(providerId, path) {
  if (providerId !== "github") return null;
  const p = String(path || "").replace(/^\//, "");
  if (p.startsWith("search/")) return "search";
  if (p === "graphql" || p.startsWith("graphql?")) return "graphql";
  return "core";
}

/** Turn an HTML error page into a short readable line (or nothing). */
function stripHtml(text) {
  if (!text) return "";
  const str = String(text);
  if (!/<[a-z!/][^>]*>/i.test(str)) return str.trim();
  const plain = str
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 160);
}

/**
 * Join the caller's abort signal with our deadline. Returns the combined
 * signal, a `timedOut()` probe, and a cleanup.
 */
function withDeadline(callerSignal, ms) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener?.("abort", onCallerAbort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener?.("abort", onCallerAbort);
    },
  };
}

export async function proxyFetch(providerId, path, init = {}) {
  if (!providerId) throw new Error("proxyFetch: providerId is required");
  const cleanPath = String(path || "").replace(/^\//, "");
  const url = `/api/v1/integrations/proxy/${providerId}/${cleanPath}`;

  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  // POST bodies stay JSON-shaped — keep callers' existing convention.
  if (method !== "GET" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const bucket = githubBucketForPath(providerId, cleanPath);
  const deadline = withDeadline(init.signal, init.deadlineMs ?? PROXY_DEADLINE_MS);
  let res;
  try {
    res = await fetchWithRateLimitRetry(
      url,
      {
        method,
        credentials: "include",
        headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
      },
      {
        provider: providerId,
        bucket,
        signal: deadline.signal,
        ...(init.fetchImpl ? { fetchImpl: init.fetchImpl } : {}),
      },
    );
  } catch (err) {
    if (deadline.timedOut()) {
      const error = new Error(
        `${providerId} took longer than ${Math.round((init.deadlineMs ?? PROXY_DEADLINE_MS) / 1000)}s to respond`,
      );
      error.status = 0;
      error.code = "timeout";
      error.provider = providerId;
      error.timedOut = true;
      throw error;
    }
    throw err;
  } finally {
    deadline.done();
  }

  if (res.status === 304) return NOT_MODIFIED;

  if (!res.ok) {
    let text = "";
    let detail = "";
    let code = null;
    let retryAfterMs = null;
    try {
      text = await res.text();
      // Surface the API's structured error message when present.
      const parsed = text ? JSON.parse(text) : null;
      detail = parsed?.error?.message || parsed?.message || text.slice(0, 200);
      code = parsed?.error?.code || parsed?.code || null;
      const ms = Number(parsed?.error?.retryAfterMs);
      if (Number.isFinite(ms)) retryAfterMs = ms;
    } catch {
      detail = detail || text.slice(0, 200);
      /* non-JSON body (an upstream HTML error page, say) — see below */
    }
    // An HTML body is never useful in a toast: strip tags and, if
    // nothing readable is left, drop it entirely.
    detail = stripHtml(detail);
    const error = new Error(
      `${providerId} ${res.status}${detail ? `: ${detail}` : ""}`,
    );
    error.status = res.status;
    error.code = code;
    error.provider = providerId;
    error.detail = detail;
    // The desktop companion answers 502 companion_unreachable when its
    // tunnel is stale — same one-per-30s toast api-client shows.
    if (res.status === 502 && code === "companion_unreachable") {
      maybeToastCompanionUnreachable(detail);
    }
    // Tag a limited response so SWR consumers can keep showing cached
    // data (and batch callers can defer the item) instead of rendering a
    // connection error. The breaker state is the source of truth for
    // `until`; the local synthetic 429 also counts.
    const limit = detectRateLimit(res.status, res.headers, text);
    if (limit || res.headers.get("x-devhub-local-rate-limit")) {
      const active = getRateLimit(providerId, bucket);
      error.rateLimited = true;
      error.code = "rate_limited";
      error.rateLimitedUntil = active?.until ?? Date.now() + (limit?.waitMs ?? retryAfterMs ?? 0);
      error.retryAfterMs = Math.max(0, error.rateLimitedUntil - Date.now());
      error.localOnly = Boolean(res.headers.get("x-devhub-local-rate-limit"));
    }
    throw error;
  }
  return res.json();
}
