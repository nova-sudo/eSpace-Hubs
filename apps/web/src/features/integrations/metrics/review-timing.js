/**
 * Review-timing metrics for a single PR.
 *
 * Vocabulary
 * ──────────
 *   TTFR      Time-to-first-review       Push → first reviewer comment.
 *   TT2R…     Time-to-Nth-review         Gap between review N-1 and review N.
 *             (TT2R = first → second review, TT3R = second → third, etc.)
 *   ATTNR     Average time-to-next-review
 *             Mean of the TT2R, TT3R, … gaps. Excludes TTFR.
 *   Idle      Sum of TTFR + every TTNthR. Total time the PR was waiting on
 *             a reviewer to respond.
 *
 * Author detection
 * ────────────────
 * A "review" is any non-author comment (issue OR pull-line). Author comments
 * are pure replies and don't reset the idle clock. If `author` is unknown
 * (e.g. older shapes without it) we fall back to counting EVERY comment as a
 * review — same behaviour as before this module existed.
 *
 * All time outputs are milliseconds. Tile/page render code is responsible
 * for formatting (we already have `fmtDurationHours` for h/d strings).
 */

/**
 * @param {{ createdAt: string, author?: string|null }} pr
 * @param {Array<{ createdAt?: string, user?: string }>} comments
 * @returns {{
 *   prCreatedAt: number|null,
 *   reviewTimes: number[],   // ms timestamps, sorted asc
 *   ttfr: number|null,       // ms
 *   nthGaps: number[],       // ms — TT2R, TT3R, …
 *   attnr: number|null,      // ms — mean of nthGaps (null when <2 reviews)
 *   idle: number,            // ms — TTFR + Σ nthGaps (0 when no reviews yet)
 *   reviewCount: number,
 *   reviewers: string[],     // unique non-author logins, in first-seen order
 * }}
 */
export function computePrReviewTiming(pr, comments) {
  const prCreatedAt = pr?.createdAt ? Date.parse(pr.createdAt) : null;
  const author = pr?.author || null;

  const reviewerEvents = (Array.isArray(comments) ? comments : [])
    .filter((c) => {
      if (!c?.createdAt) return false;
      // If we know the author, exclude their own comments. Otherwise count all
      // comments as review events (legacy behaviour).
      if (author && c.user && c.user === author) return false;
      return true;
    })
    .map((c) => ({ ts: Date.parse(c.createdAt), user: c.user || "unknown" }))
    .filter((e) => Number.isFinite(e.ts))
    .sort((a, b) => a.ts - b.ts);

  const reviewTimes = reviewerEvents.map((e) => e.ts);
  const reviewers = [];
  const seen = new Set();
  for (const e of reviewerEvents) {
    if (seen.has(e.user)) continue;
    seen.add(e.user);
    reviewers.push(e.user);
  }

  let ttfr = null;
  if (prCreatedAt != null && reviewTimes.length > 0) {
    const gap = reviewTimes[0] - prCreatedAt;
    ttfr = gap >= 0 ? gap : null;
  }

  const nthGaps = [];
  for (let i = 1; i < reviewTimes.length; i++) {
    const gap = reviewTimes[i] - reviewTimes[i - 1];
    if (gap >= 0) nthGaps.push(gap);
  }

  const attnr =
    nthGaps.length > 0
      ? nthGaps.reduce((s, g) => s + g, 0) / nthGaps.length
      : null;

  const idle = (ttfr || 0) + nthGaps.reduce((s, g) => s + g, 0);

  return {
    prCreatedAt,
    reviewTimes,
    ttfr,
    nthGaps,
    attnr,
    idle,
    reviewCount: reviewTimes.length,
    reviewers,
  };
}

/**
 * Aggregate timing across many PRs into the dashboard headline numbers.
 *
 * @param {Array<ReturnType<typeof computePrReviewTiming>>} timings
 * @returns {{
 *   medianTtfr: number|null,
 *   medianAttnr: number|null,
 *   totalIdle: number,
 *   prCount: number,
 *   prsWithReview: number,
 * }}
 */
export function aggregateTiming(timings) {
  const ttfrs = [];
  const attnrs = [];
  let totalIdle = 0;
  let prsWithReview = 0;
  for (const t of timings || []) {
    if (!t) continue;
    if (t.ttfr != null) ttfrs.push(t.ttfr);
    if (t.attnr != null) attnrs.push(t.attnr);
    totalIdle += t.idle || 0;
    if (t.reviewCount > 0) prsWithReview += 1;
  }
  return {
    medianTtfr: median(ttfrs),
    medianAttnr: median(attnrs),
    totalIdle,
    prCount: (timings || []).length,
    prsWithReview,
  };
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Format a millisecond duration as a short human string (m / h / d).
 * Mirrors the spirit of `fmtDurationHours` but takes ms so this module
 * stays self-contained.
 */
export function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const abs = Math.abs(ms);
  const minutes = abs / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = abs / 3_600_000;
  if (hours < 24) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  const days = hours / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)}d`;
}
