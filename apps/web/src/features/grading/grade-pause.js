/**
 * How long a PR-grading run pauses after a rate-limit response.
 *
 * The generic client retry (`lib/rate-limit.js`) caps each wait at two
 * minutes and gives up after six tries — right for provider blips, wrong
 * for OUR `gradePrLimiter`, whose window is 15 minutes: a "grade all" over
 * a heavy backlog used to burn six capped waits (and six toasts per
 * worker) and then abandon the tail. The grader instead waits for the
 * window the server actually advertises, once, for the whole run.
 *
 * Precedence: `Retry-After` (seconds or HTTP date) → the draft-7
 * `RateLimit: …, reset=N` header express-rate-limit sends → the envelope's
 * `error.retryAfterMs` (model-provider limits) → a linear 30s-per-attempt
 * fallback. Clamped to [1s, MAX_PAUSE_MS].
 */

/** Longest single pause — a hair over the 15-minute limiter window. */
export const MAX_PAUSE_MS = 16 * 60_000;
/** Pauses one PR may sit through before the run leaves it for later. */
export const MAX_PAUSES_PER_PR = 3;

function clamp(ms) {
  if (!Number.isFinite(ms)) return null;
  return Math.min(MAX_PAUSE_MS, Math.max(1_000, ms));
}

export function gradePrPauseMs(headers, body, attempt = 1, now = Date.now()) {
  const ra = headers?.get?.("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return clamp(secs * 1000);
    const when = Date.parse(ra);
    if (Number.isFinite(when)) return clamp(when - now);
  }
  const draft7 = headers?.get?.("ratelimit");
  if (draft7) {
    const m = /reset=(\d+)/i.exec(draft7);
    if (m) return clamp(Number(m[1]) * 1000);
  }
  const fromBody = Number(body?.error?.retryAfterMs);
  if (Number.isFinite(fromBody) && fromBody > 0) return clamp(fromBody);
  return clamp(30_000 * Math.max(1, attempt));
}

/** "Grading 12/40…" or "Paused by the rate limit · resumes 14:05 · 12/40". */
export function gradeProgressLabel(progress, now = Date.now()) {
  if (!progress?.running) return null;
  const count = `${progress.done ?? 0}/${progress.total ?? 0}`;
  if (progress.pausedUntil && progress.pausedUntil > now) {
    const at = new Date(progress.pausedUntil).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Paused by the rate limit · resumes ${at} · ${count}`;
  }
  return `Grading ${count}…`;
}
