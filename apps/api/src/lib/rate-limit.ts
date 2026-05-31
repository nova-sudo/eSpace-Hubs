/**
 * Rate-limit helpers shared by the upstream callers (AI providers, the
 * provider proxies). Parses the standard rate-limit signals and retries
 * a fetch a BOUNDED number of times, honouring the server-indicated
 * wait.
 *
 * Bounded on purpose: this runs inside a serverless function with a
 * hard wall-clock budget (Vercel ~60s). We can smooth over short burst
 * limits — Mistral typically returns `Retry-After` in single-digit
 * seconds — but we cannot sit out GitHub's hour-long primary reset from
 * here. For those, the caller surfaces the wait to the browser (via a
 * `Retry-After` header / `error.retryAfterMs` envelope field) so the
 * client can wait and resume in the background without holding a
 * function open.
 */

/** Minimal structural view of a fetch `Headers` — avoids depending on a
 *  globally-available `Headers` lib type. */
interface HeaderReader {
  get(name: string): string | null;
}

/** Minimal structural view of a fetch `Response`. */
interface MinimalResponse {
  status: number;
  headers: HeaderReader;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Wait (ms) indicated by rate-limit headers, or null when none present.
 *   - `Retry-After`: delta-seconds OR an HTTP-date.
 *   - `X-RateLimit-Remaining: 0` + `X-RateLimit-Reset` (epoch seconds):
 *     GitHub / GitLab style.
 */
export function retryAfterMsFromHeaders(headers: HeaderReader): number | null {
  const ra = headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const when = Date.parse(ra);
    if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  }
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining === "0" && reset) {
    const resetMs = Number(reset) * 1000;
    if (Number.isFinite(resetMs)) return Math.max(0, resetMs - Date.now());
  }
  return null;
}

/** True when a response is a rate-limit rejection (vs a plain error). */
export function isRateLimited(status: number, headers: HeaderReader): boolean {
  if (status === 429) return true;
  // GitHub answers 403 for BOTH bad credentials and rate limits; only
  // the rate-limit case zeroes the remaining counter.
  if (status === 403 && headers.get("x-ratelimit-remaining") === "0") {
    return true;
  }
  return false;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface RetryOpts {
  /** Total fetch attempts (default 3). */
  maxAttempts?: number;
  /** Cumulative wait ceiling across all retries (default 25s). */
  maxTotalWaitMs?: number;
  signal?: AbortSignal;
  onWait?: (info: { attempt: number; waitMs: number; status: number }) => void;
}

/**
 * Run `doFetch` and, on a rate-limit response, wait the indicated time
 * and retry — up to `maxAttempts` and `maxTotalWaitMs`. Returns the
 * final response (which MAY still be a 429 when the budget is exhausted
 * — the caller decides how to surface that). Never throws on rate
 * limit; network errors from `doFetch` propagate to the caller.
 */
export async function fetchWithRateLimitRetry<T extends MinimalResponse>(
  doFetch: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const maxTotalWaitMs = opts.maxTotalWaitMs ?? 25_000;
  let waited = 0;
  for (let attempt = 1; ; attempt += 1) {
    const res = await doFetch();
    if (!isRateLimited(res.status, res.headers)) return res;
    if (attempt >= maxAttempts) return res;
    const indicated =
      retryAfterMsFromHeaders(res.headers) ??
      Math.min(2_000 * 2 ** (attempt - 1), 8_000); // 2s, 4s, 8s…
    // Small jitter so concurrent callers waiting on the same reset
    // don't all retry on the exact same tick (thundering herd).
    const jitter = Math.floor(Math.random() * 750);
    const waitMs = Math.min(indicated + jitter, maxTotalWaitMs - waited);
    if (waitMs <= 0) return res;
    waited += waitMs;
    opts.onWait?.({ attempt, waitMs, status: res.status });
    // Drain the body so the socket is freed before we retry.
    try {
      await res.arrayBuffer();
    } catch {
      /* ignore — some bodies aren't buffer-able, not fatal */
    }
    try {
      await sleep(waitMs, opts.signal);
    } catch {
      return res; // aborted while waiting — hand back the limited response
    }
  }
}
