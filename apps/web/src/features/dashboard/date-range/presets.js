import { DAY_MS } from "@/lib/date";
import { readLastReviewDate } from "./last-review-store";

/**
 * Dashboard date-range presets.
 *
 * Two shapes:
 *   - Rolling: "30d" / "90d" — last N days vs. the previous N days
 *   - Calendar: "week" / "month" / "quarter" / "year" — current calendar
 *     period vs. the same period previous
 *
 * Default is rolling 30d because calendar periods are empty at the start of
 * each bucket (day 1 of a new quarter has no data). Calendar presets stay
 * so users can deliberately align to review cycles.
 */

export const PRESET_IDS = [
  "30d",
  "90d",
  "week",
  "month",
  "quarter",
  "year",
  "ytd",
  "lastreview",
];
export const DEFAULT_PRESET = "30d";

export const PRESETS = {
  "30d": { id: "30d", label: "30D", hint: "Last 30 days vs. previous 30" },
  "90d": { id: "90d", label: "90D", hint: "Last 90 days vs. previous 90" },
  week: { id: "week", label: "Week", hint: "This week vs. last week" },
  month: { id: "month", label: "Month", hint: "This month vs. last month" },
  quarter: {
    id: "quarter",
    label: "Quarter",
    hint: "This quarter vs. last quarter",
  },
  year: { id: "year", label: "Year", hint: "This year vs. last year" },
  ytd: {
    id: "ytd",
    label: "YTD",
    hint: "Jan 1 → now vs. same window last year",
  },
  lastreview: {
    id: "lastreview",
    label: "Since review",
    hint: "Since your last review date (set in Settings)",
  },
};

// ── calendar helpers ─────────────────────────────────────────

/**
 * Start of the current Sunday-anchored week (00:00 local time).
 *
 * Renamed in spirit only — ISO 8601 anchors weeks on Monday, but this
 * app's audience uses a Sun → Thu work week, so we anchor on Sunday. The
 * function name stays `startOfISOWeek` to avoid a rename ripple through
 * the resolver.
 */
function startOfISOWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfQuarter(date) {
  const d = new Date(date);
  const qm = Math.floor(d.getMonth() / 3) * 3;
  d.setMonth(qm, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfYear(date) {
  const d = new Date(date);
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

// ── range resolution ────────────────────────────────────────

function resolveImpl(preset, now) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();

  // Rolling: "30d", "90d", etc.
  const rollingMatch = /^(\d+)d$/.exec(preset);
  if (rollingMatch) {
    const days = parseInt(rollingMatch[1], 10);
    const start = new Date(nowMs - days * DAY_MS);
    const prevStart = new Date(nowMs - 2 * days * DAY_MS);
    return build({
      id: preset,
      label: `Last ${days} days`,
      start,
      end: new Date(nowMs),
      prevStart,
      prevEnd: start,
      days,
      fetchSince: prevStart,
    });
  }

  if (preset === "week") {
    const start = startOfISOWeek(nowDate);
    const prevStart = new Date(start.getTime() - 7 * DAY_MS);
    return build({
      id: "week",
      label: "This week",
      start,
      end: new Date(nowMs),
      prevStart,
      prevEnd: start,
      days: 7,
      fetchSince: prevStart,
    });
  }

  if (preset === "quarter") {
    const start = startOfQuarter(nowDate);
    const prevStart = startOfQuarter(addMonths(start, -3));
    return build({
      id: "quarter",
      label: "This quarter",
      start,
      end: new Date(nowMs),
      prevStart,
      prevEnd: start,
      days: Math.ceil((nowMs - start.getTime()) / DAY_MS),
      fetchSince: prevStart,
    });
  }

  if (preset === "year") {
    const start = startOfYear(nowDate);
    const prevStart = startOfYear(addMonths(start, -12));
    return build({
      id: "year",
      label: "This year",
      start,
      end: new Date(nowMs),
      prevStart,
      prevEnd: start,
      days: Math.ceil((nowMs - start.getTime()) / DAY_MS),
      fetchSince: prevStart,
    });
  }

  if (preset === "ytd") {
    // Year-to-date — Jan 1 → now, compared to the same calendar window in
    // the previous year (so users can ask "am I ahead of last year?").
    const start = startOfYear(nowDate);
    const prevStart = startOfYear(addMonths(start, -12));
    const prevEnd = addMonths(nowDate, -12);
    return build({
      id: "ytd",
      label: "Year to date",
      start,
      end: new Date(nowMs),
      prevStart,
      prevEnd,
      days: Math.max(1, Math.ceil((nowMs - start.getTime()) / DAY_MS)),
      fetchSince: prevStart,
    });
  }

  if (preset === "lastreview") {
    // "Since my last review" — anchored to a user-set date in Settings.
    // Falls back to a 90-day rolling window when no date is configured so
    // the chip never produces an empty dashboard for new users.
    const iso = readLastReviewDate();
    const reviewDate = iso ? new Date(iso) : null;
    if (!reviewDate || Number.isNaN(reviewDate.getTime())) {
      return resolveImpl("90d", nowDate);
    }
    reviewDate.setHours(0, 0, 0, 0);
    const start = reviewDate;
    const periodMs = nowMs - start.getTime();
    const prevStart = new Date(start.getTime() - periodMs);
    return build({
      id: "lastreview",
      label: "Since last review",
      start,
      end: new Date(nowMs),
      prevStart,
      prevEnd: start,
      days: Math.max(1, Math.ceil(periodMs / DAY_MS)),
      fetchSince: prevStart,
    });
  }

  // default: month
  const start = startOfMonth(nowDate);
  const prevStart = startOfMonth(addMonths(start, -1));
  return build({
    id: "month",
    label: "This month",
    start,
    end: new Date(nowMs),
    prevStart,
    prevEnd: start,
    days: Math.max(1, Math.ceil((nowMs - start.getTime()) / DAY_MS)),
    fetchSince: prevStart,
  });
}

function build(range) {
  // Pre-compute the ISO key the SWR layer uses so cache dedupe is free.
  return { ...range, fetchSinceISO: range.fetchSince.toISOString() };
}

// ── module-level cache ──────────────────────────────────────
//
// Critical for SWR: every dashboard tile calls `resolveRange(preset)`
// independently, and if each got a different Date instance, SWR's cache key
// (the fetchSince ISO) would differ by milliseconds between tiles — 6 tiles
// = 6 duplicate fetches. Caching per (preset, day) forces all tiles to share
// one fetch, and lets the cache roll over at midnight.
const _cache = new Map();

export function resolveRange(preset = DEFAULT_PRESET, now = new Date()) {
  const dayKey = now.toISOString().slice(0, 10);
  // `lastreview` depends on a user-mutable date in localStorage. Mix that
  // value into the key so flipping the date in Settings invalidates the
  // cache without requiring a full page reload.
  const dateAnchor = preset === "lastreview" ? `:${readLastReviewDate()}` : "";
  const key = `${preset}:${dayKey}${dateAnchor}`;
  const hit = _cache.get(key);
  if (hit) return hit;
  const resolved = resolveImpl(preset, now);
  _cache.set(key, resolved);
  return resolved;
}

/**
 * Split a list by a timestamp-extracting function into current + previous
 * periods. Items outside both windows are discarded.
 */
export function splitByRange(items, range, getTimestamp) {
  const current = [];
  const previous = [];
  const s = range.start.getTime();
  const e = range.end.getTime();
  const ps = range.prevStart.getTime();
  const pe = range.prevEnd.getTime();
  for (const it of items) {
    const ts = new Date(getTimestamp(it) || 0).getTime();
    if (!Number.isFinite(ts) || ts === 0) continue;
    if (ts >= s && ts <= e) current.push(it);
    else if (ts >= ps && ts < pe) previous.push(it);
  }
  return { current, previous };
}
