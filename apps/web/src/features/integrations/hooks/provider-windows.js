/**
 * Canonical provider fetch windows — pure helpers, no React.
 *
 * Before this module every consumer asked the provider for ITS OWN window
 * (30d, 90d, 120d, 365d, YTD, the Reviews preset's millisecond-precise
 * `fetchSince` …), and each window was a separate SWR key and therefore a
 * separate paginated GitHub search / GitLab walk — the same merged-PR list
 * fetched up to four times per page. Now the hooks fetch ONE list per
 * provider and resource:
 *
 *   - merged PRs / MRs and authored PRs: the LONG window — whichever of
 *     "365 days back" and "year to date" reaches further, snapped to local
 *     midnight. Every in-app consumer (backfill's 365d, YTD widgets, the
 *     snapshot 30/90/120d reads) is a subset of it.
 *   - events: the SHORT window — 90 days (GitHub's public events feed
 *     cannot go further back anyway), snapped to local midnight.
 *
 * and derive each caller's view client-side with the `filter*Since`
 * helpers below. A caller asking for something OLDER than the canonical
 * window (e.g. the Reviews "this year" preset's previous-year comparison)
 * still gets its own fetch, keyed on its `since` snapped to local midnight
 * so the key is stable for the whole day.
 *
 * Keys therefore change at most once per day (the canonical start moves at
 * local midnight), which is what lets the persisted SWR cache serve a
 * revisit without touching the provider.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Days the long (merged / authored) canonical window reaches back. */
export const LONG_WINDOW_DAYS = 366;
/** Days the short (events) canonical window reaches back. */
export const EVENTS_WINDOW_DAYS = 91;

/** Local midnight (00:00 in the browser's zone) of the day `input` falls on. */
export function localMidnight(input = new Date()) {
  const d = new Date(input instanceof Date ? input.getTime() : input);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Normalise a hook's `since` argument (Date | days-ago number | ISO string |
 * null) to an ISO string snapped to local midnight, or null for "not needed".
 * Snapping is what keeps SWR keys stable across renders and visits: the
 * Reviews preset used to hand over `now − 60d` to the millisecond, so every
 * mount minted a brand-new key and refetched.
 */
export function snapSinceIso(since, now = new Date()) {
  if (since == null || since === "") return null;
  let ms;
  if (since instanceof Date) ms = since.getTime();
  else if (typeof since === "number") ms = now.getTime() - since * DAY_MS;
  else if (typeof since === "string") ms = Date.parse(since);
  else return null;
  if (!Number.isFinite(ms)) return null;
  return localMidnight(ms).toISOString();
}

/** Start of the long canonical window as an ISO string (see header). */
export function canonicalMergedSinceIso(now = new Date()) {
  const rolling = localMidnight(now.getTime() - LONG_WINDOW_DAYS * DAY_MS).getTime();
  const localJan1 = new Date(now.getFullYear(), 0, 1).getTime();
  const utcJan1 = Date.UTC(now.getUTCFullYear(), 0, 1);
  return new Date(Math.min(rolling, localJan1, utcJan1)).toISOString();
}

/** Start of the short (events) canonical window as an ISO string. */
export function canonicalEventsSinceIso(now = new Date()) {
  return localMidnight(now.getTime() - EVENTS_WINDOW_DAYS * DAY_MS).toISOString();
}

/**
 * Which window to FETCH for a caller's `since`, and what to filter to.
 *
 * `canonicals` is an ordered list of canonical window starts, shortest
 * (latest) first. The first canonical window that fully covers `since` is
 * fetched; when none does, the caller's own snapped `since` is.
 *
 * @returns {{ fetchIso: string, filterIso: string } | null}
 */
export function resolveFetchWindow(since, canonicals, now = new Date()) {
  const filterIso = snapSinceIso(since, now) && isoOf(since, now);
  if (!filterIso) return null;
  const wanted = Date.parse(filterIso);
  for (const c of canonicals) {
    if (c && Date.parse(c) <= wanted) return { fetchIso: c, filterIso };
  }
  return { fetchIso: snapSinceIso(since, now), filterIso };
}

/** The caller's exact cutoff (un-snapped) as an ISO string. */
function isoOf(since, now) {
  if (since instanceof Date) return since.toISOString();
  if (typeof since === "number") return new Date(now.getTime() - since * DAY_MS).toISOString();
  if (typeof since === "string") {
    const ms = Date.parse(since);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
}

function ms(v) {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Slice a canonical merged-PR/MR list down to what a per-window fetch
 * would have returned, so consumers see exactly the rows they used to:
 *
 *   - GitHub rows came from `merged:>=YYYY-MM-DD` — a DAY-granular search
 *     on the UTC date of the cutoff — so they are kept from that UTC day on.
 *   - GitLab rows came from `updated_after=<iso>` — so they are kept when
 *     `updated_at` (falling back to `merged_at`) is at/after the cutoff.
 *     Consumers already re-slice on `merged_at` (`mergedWithin`), exactly
 *     as they did with the per-window fetch.
 *
 * Returns the input untouched when it isn't an array.
 */
export function filterMergedSince(list, sinceIso) {
  if (!Array.isArray(list) || !sinceIso) return list;
  const exact = ms(sinceIso);
  if (!Number.isFinite(exact)) return list;
  const dayFloor = Date.parse(`${new Date(exact).toISOString().slice(0, 10)}T00:00:00.000Z`);
  return list.filter((m) => {
    if (!m) return false;
    if (m.source === "github") {
      const t = ms(m.merged_at);
      return Number.isFinite(t) && t >= dayFloor;
    }
    const t = ms(m.updated_at);
    const fallback = ms(m.merged_at);
    const when = Number.isFinite(t) ? t : fallback;
    return Number.isFinite(when) && when >= exact;
  });
}

/** Events (real or PR-synthesised) created at/after the cutoff. */
export function filterEventsSince(list, sinceIso) {
  if (!Array.isArray(list) || !sinceIso) return list;
  const cutoff = ms(sinceIso);
  if (!Number.isFinite(cutoff)) return list;
  return list.filter((e) => {
    const t = ms(e?.created_at);
    return Number.isFinite(t) && t >= cutoff;
  });
}

/**
 * Authored-PR search items (raw `search/issues` rows, `created:>=DAY`) at/
 * after the UTC day of the cutoff — the same boundary the per-window
 * search applied.
 */
export function filterAuthoredSince(list, sinceIso) {
  if (!Array.isArray(list) || !sinceIso) return list;
  const exact = ms(sinceIso);
  if (!Number.isFinite(exact)) return list;
  const dayFloor = Date.parse(`${new Date(exact).toISOString().slice(0, 10)}T00:00:00.000Z`);
  return list.filter((it) => {
    const t = ms(it?.created_at);
    return Number.isFinite(t) && t >= dayFloor;
  });
}
