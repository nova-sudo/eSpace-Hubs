"use client";

/**
 * Client-side rate-limit handling, shared by the provider proxy fetcher
 * (`proxyFetch`) and the AI batch orchestrators (PR grading, goal
 * classification).
 *
 * The API streams upstream rate-limit signals straight through — the
 * proxy's passthrough allowlist includes `Retry-After`,
 * `X-RateLimit-Reset` and `X-RateLimit-Remaining` — and the AI
 * controller forwards the model provider's `Retry-After` as both a
 * `Retry-After` header and an `error.retryAfterMs` envelope field. We
 * read those here to wait exactly as long as the upstream asks, then
 * resume, so a 429 PAUSES the work instead of failing it.
 *
 * "In the background": these are async calls the UI already awaits
 * behind progress indicators; waiting + retrying inside the promise
 * keeps the page responsive while the batch quietly resumes. A throttled
 * toast tells the user it's waiting rather than stuck.
 */

import { toast } from "sonner";

export const RATE_LIMIT_EVENT = "espace-devhub:rate-limit-wait";

/**
 * Largest single wait we'll honour before giving up. GitHub's PRIMARY
 * rate limit can reset up to an hour out — we won't freeze the tab that
 * long; we cap the wait, and if the limit persists the caller surfaces a
 * normal error (and the work can be re-run later).
 */
const MAX_SINGLE_WAIT_MS = 2 * 60_000; // 2 minutes

/** Default attempt ceiling for a single logical request. */
export const DEFAULT_MAX_ATTEMPTS = 6;

/** True when a response is a rate-limit rejection (vs a plain error). */
export function isRateLimitStatus(status, headers) {
  if (status === 429) return true;
  // GitHub answers 403 for BOTH bad credentials and rate limits; only
  // the rate-limit case zeroes the remaining counter.
  if (status === 403 && headers?.get?.("x-ratelimit-remaining") === "0") {
    return true;
  }
  return false;
}

function clampWait(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(ms, MAX_SINGLE_WAIT_MS);
}

/**
 * Parse the wait (ms) from a rate-limited response's headers, with the
 * parsed JSON body as a fallback (our API exposes the model provider's
 * delay as `error.retryAfterMs`). Falls back to exponential backoff with
 * jitter when nothing is advertised.
 */
export function rateLimitDelayMs(status, headers, body, attempt = 1) {
  // 1) Retry-After: delta-seconds OR an HTTP-date.
  const ra = headers?.get?.("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return clampWait(secs * 1000);
    const when = Date.parse(ra);
    if (Number.isFinite(when)) return clampWait(when - Date.now());
  }
  // 2) Our API forwards the model provider's wait as error.retryAfterMs.
  const fromBody = Number(body?.error?.retryAfterMs);
  if (Number.isFinite(fromBody) && fromBody > 0) return clampWait(fromBody);
  // 3) GitHub/GitLab: epoch-seconds reset when the window is exhausted.
  const remaining = headers?.get?.("x-ratelimit-remaining");
  const reset = headers?.get?.("x-ratelimit-reset");
  if (remaining === "0" && reset) {
    const resetMs = Number(reset) * 1000;
    if (Number.isFinite(resetMs)) return clampWait(resetMs - Date.now());
  }
  // 4) Fallback: exponential backoff (2s, 4s, 8s…) + jitter.
  const backoff = Math.min(2_000 * 2 ** (attempt - 1), 30_000);
  return clampWait(backoff + Math.random() * 1_000);
}

/** Cancellable sleep. Rejects with an AbortError if the signal fires. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

// Throttle the "waiting" toast so a fan-out of concurrent workers all
// hitting the same limit doesn't stack a dozen toasts.
const _lastToastAt = {};
const TOAST_THROTTLE_MS = 10_000;

/** Non-blocking notification the user is being made to wait. */
export function notifyRateLimitWait({ provider, waitMs, attempt }) {
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent(RATE_LIMIT_EVENT, {
          detail: { provider, waitMs, attempt },
        }),
      );
    } catch {
      /* ignore */
    }
  }
  const now = Date.now();
  if (!_lastToastAt[provider] || now - _lastToastAt[provider] > TOAST_THROTTLE_MS) {
    _lastToastAt[provider] = now;
    const secs = Math.max(1, Math.ceil(waitMs / 1000));
    const who =
      provider === "ai"
        ? "AI provider"
        : provider === "upstream"
          ? "Upstream"
          : provider;
    try {
      toast.message(
        `${who} rate limit hit — waiting ${secs}s, then continuing…`,
        { duration: Math.min(Math.max(waitMs, 3_000), 6_000) },
      );
    } catch {
      /* sonner not mounted (SSR / tests) — ignore */
    }
  }
}

/**
 * Run `fetch(input, init)` and, on a rate-limit response, wait the
 * indicated time and retry — up to `maxAttempts`. Returns the final
 * Response (the caller reads `.ok` / `.json()` as usual). Throws only on
 * a network error or an abort (AbortError) while waiting.
 *
 * The same `init` is replayed each attempt, so this is only used for
 * idempotent reads or for requests a 429 guarantees were NOT processed
 * (a rate-limited request never reached the handler).
 */
export async function fetchWithRateLimitRetry(input, init = {}, opts = {}) {
  const { maxAttempts = DEFAULT_MAX_ATTEMPTS, signal, provider = "upstream" } =
    opts;
  const requestInit = signal ? { ...init, signal } : init;
  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch(input, requestInit);
    if (
      res.ok ||
      !isRateLimitStatus(res.status, res.headers) ||
      attempt >= maxAttempts
    ) {
      return res;
    }
    // Peek at the body for a forwarded retryAfterMs without consuming
    // the caller-visible stream.
    let body = null;
    try {
      body = await res.clone().json();
    } catch {
      /* not JSON — headers still drive the wait */
    }
    const waitMs = rateLimitDelayMs(res.status, res.headers, body, attempt);
    if (waitMs <= 0) return res;
    notifyRateLimitWait({ provider, waitMs, attempt });
    // May throw AbortError → propagates to the caller, which treats it
    // as a cancellation (not a grading failure).
    await sleep(waitMs, signal);
  }
}
