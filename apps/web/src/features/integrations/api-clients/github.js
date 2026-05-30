import { proxyFetch } from "./proxy-fetch";
import { readIntegrations, saveConnection } from "../integrations-store";

/**
 * Resolve the connected user's GitHub login.
 *
 * Reads from localStorage first (populated by the OAuth callback after a
 * successful `/user` lookup). When it's missing — which happens for users
 * who connected before the M-CAP content-encoding hotfix, because that bug
 * silently broke the callback's profile fetch — we recover by calling
 * `/user` here and back-filling the local cache so this branch only runs
 * once per browser.
 *
 * The recovery promise is memoised at module scope so the dozen-ish tiles
 * that hit `myEventsSince` in parallel on a fresh page load share a single
 * `/user` round-trip instead of dog-piling the proxy. The promise is
 * cleared on success so a later disconnect+reconnect can re-recover if
 * needed.
 */
let _usernameRecoveryPromise = null;
async function resolveGithubUsername() {
  const stored = readIntegrations().github?.username;
  if (stored) return stored;
  if (!_usernameRecoveryPromise) {
    _usernameRecoveryPromise = (async () => {
      try {
        const me = await proxyFetch("github", "user");
        if (!me?.login) {
          throw new Error(
            "GitHub /user returned no login — reconnect required.",
          );
        }
        // Persist locally + mirror to the server-side integrations row.
        saveConnection("github", {
          username: me.login,
          displayName: me.name,
          avatarUrl: me.avatar_url,
        });
        return me.login;
      } finally {
        // Don't pin a permanent reference — let a future disconnect or
        // forced re-fetch re-enter this path.
        _usernameRecoveryPromise = null;
      }
    })();
  }
  return _usernameRecoveryPromise;
}

/**
 * Page through GitHub's search/issues endpoint until we've collected
 * every result for the query, or we hit GitHub's hard 1000-result
 * ceiling per search (it'll start 422-ing past that anyway).
 *
 * Why this exists: the rubric widget needs the user's FULL year of
 * PRs to give an honest "Wnn · N/M graded" breakdown across past
 * weeks. The previous single-page call dropped the older pages
 * silently, which made the per-week dropdown look like only the
 * last 3 weeks had any merges — even for authors with 150+ merged
 * PRs/year.
 *
 * Pages are fetched serially. Search is rate-limited at 30 req/min
 * per user; ten serial requests still finish in under a second,
 * and parallel fetches would risk tripping the rate limit if the
 * caller is one of several tiles loading at once.
 */
const SEARCH_PER_PAGE = 100;
const SEARCH_MAX_RESULTS = 1000; // GitHub hard cap per search
async function searchIssuesPaginated(rawQuery) {
  const q = encodeURIComponent(rawQuery);
  const out = [];
  for (let page = 1; out.length < SEARCH_MAX_RESULTS; page++) {
    const res = await proxyFetch(
      "github",
      `search/issues?q=${q}&per_page=${SEARCH_PER_PAGE}&page=${page}`,
    );
    const items = Array.isArray(res?.items) ? res.items : [];
    if (items.length === 0) break;
    out.push(...items);
    if (items.length < SEARCH_PER_PAGE) break;
    // Stop walking if we just hit the 1000-result ceiling; the next
    // page would 422.
    if (page * SEARCH_PER_PAGE >= SEARCH_MAX_RESULTS) break;
  }
  return out;
}

export const githubApi = {
  me: () => proxyFetch("github", "user"),

  myOpenPulls: () =>
    proxyFetch(
      "github",
      "search/issues?q=" + encodeURIComponent("is:pr author:@me state:open"),
    ),

  reviewRequests: () =>
    proxyFetch(
      "github",
      "search/issues?q=" + encodeURIComponent("is:pr review-requested:@me state:open"),
    ),

  /**
   * PRs authored by the current user and merged at/after isoDate.
   * Uses GitHub issue-search, which returns `pull_request.merged_at` on each hit.
   *
   * Paginated to GitHub's 1000-result search ceiling. Heavy authors
   * (Crealogix scale) merge well over 100 PRs across the backfill window
   * (a year), and this list is what drives the snapshot "merged" count +
   * the weekly buckets in `synthesiseWeek`. The previous single 100-item
   * page got fully consumed by the two most recent weeks, so every older
   * week synthesised as 0 merged even though the PRs existed — the exact
   * failure `myPrsSince` already paginates around. Returns the raw search
   * items array; `normalizeGithubMergedSearch` accepts an array or a
   * `{ items }` envelope.
   */
  myMergedSince: (isoDate) => {
    const day = (isoDate || "").slice(0, 10);
    const q = `is:pr author:@me is:merged merged:>=${day}`;
    return searchIssuesPaginated(q);
  },

  /**
   * User's public event stream since isoDate.
   *
   * GitHub's `/users/:u/events/public` caps the response at:
   *   - 100 events per page
   *   - 3 pages total (300 events absolute max)
   *   - ~90 days regardless of pagination
   *
   * For a heavy day where 100+ events fire, page 1 alone is consumed by
   * today and everything older is invisible until we paginate. (This is
   * exactly what produced the "100 events / peak 100/day" YTD heatmap
   * with an otherwise-empty Jan–Apr grid.)
   *
   * We page through up to 3 pages, short-circuiting when:
   *   - the batch comes back short (< 100) — we got everything available
   *   - the oldest event on a page is already before the requested
   *     `isoDate` cutoff — caller's window is already covered
   *
   * Self-heals the local `github.username` cache via `resolveGithubUsername`
   * if it's missing — historically a user who connected before the
   * content-encoding hotfix would have a token but no username, and every
   * events-driven tile (Activity / Signal / Heatmap / Reviews) would
   * silently return empty.
   */
  myEventsSince: async (isoDate) => {
    const username = await resolveGithubUsername();
    const cutoffMs =
      typeof isoDate === "string" && isoDate
        ? new Date(isoDate).getTime()
        : 0;
    const MAX_PAGES = 3;
    const PER_PAGE = 100;
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      let batch;
      try {
        batch = await proxyFetch(
          "github",
          `users/${encodeURIComponent(username)}/events/public?per_page=${PER_PAGE}&page=${page}`,
        );
      } catch (err) {
        // GitHub returns 422 ("In order to keep the API fast for
        // everyone, pagination is limited for this resource.") once
        // the per-resource pagination cap is exceeded. Treat it as
        // "we already have everything this endpoint will give" and
        // surface what we collected so far — failing the whole hook
        // because page N+1 hit the cap would be hostile to the
        // dashboard's events-driven tiles.
        //
        // If page 1 itself fails we genuinely have nothing; re-throw
        // so SWR can flag the tile.
        if (page === 1) throw err;
        break;
      }
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      // NOTE: we do NOT short-circuit on `batch.length < PER_PAGE`.
      // GitHub's `/users/:u/events/public` regularly returns 99
      // (or fewer) events on a page that still has a `Link:
      // rel="next"` — events from private repos that have since
      // been flipped public, or vice-versa, leave gaps that the
      // count doesn't reveal. The authoritative end-of-stream
      // signal is the 422 caught above OR an empty array. The
      // older heuristic dropped page 3 entirely on busy accounts
      // (verified on the wire: page 2 = 99, but page 3 had a
      // full 100 events of older data).
      //
      // Oldest event on this page is already past the caller's window
      // → no need to walk further into history.
      if (cutoffMs > 0) {
        const oldest = batch[batch.length - 1];
        const oldestMs = oldest?.created_at
          ? new Date(oldest.created_at).getTime()
          : 0;
        if (oldestMs > 0 && oldestMs < cutoffMs) break;
      }
    }
    return all;
  },

  /**
   * Every PR the current user authored since isoDate, regardless of state
   * (open, closed-unmerged, merged) and including drafts. Used to
   * synthesise "PR opened" / "PR merged" event-shaped records that
   * supplement the events feed for older periods — the user-events
   * endpoint hard-caps at 300 events / 90 days and gets fully consumed
   * by recent heavy days, so April/March activity drops off entirely.
   * The search-issues endpoint, by contrast, has no such cap.
   *
   * Unlike `myPrsSince` which runs two queries (is:open / is:merged) to
   * dodge GitHub's flaky draft flag, this method takes the union with a
   * single query because activity-feed callers want EVERY PR — drafts
   * included, since a draft still represents real work that day. Closed-
   * unmerged PRs are also useful: they show "tried something, abandoned"
   * markers on the heatmap.
   *
   * Paginated up to GitHub's 1000-result ceiling — heavy authors with
   * >100 PRs/year (Crealogix scale) need this to see their full
   * year's activity on the heatmap. Uses the shared helper that
   * also backs `myPrsSince`.
   */
  myAuthoredPrsSince: async (isoDate) => {
    const day = (isoDate || "").slice(0, 10);
    const q = `is:pr author:@me created:>=${day}`;
    return searchIssuesPaginated(q);
  },

  /**
   * PRs authored by the user since isoDate, INCLUDING both open and merged
   * (but NOT drafts). Used by the CODE_RUBRIC widget to collect the full
   * "year-to-date" set for grading.
   *
   * We run two searches (is:open, is:merged) rather than one no-state
   * query so each call returns clean results we don't have to re-filter
   * on the client for draft-state (search-issues doesn't expose the
   * `draft` flag reliably). Each search is paginated to GitHub's
   * `MAX_SEARCH_RESULTS` ceiling so heavy authors with >100 PRs/year
   * (i.e. anyone who actually wants the rubric widget) get the full
   * picture — without pagination we'd silently truncate the older
   * pages and the per-week dropdown would only ever show the most-
   * recent ~3 weeks of merges.
   */
  myPrsSince: async (isoDate) => {
    const day = (isoDate || "").slice(0, 10);
    const q = (extra) =>
      `is:pr author:@me -is:draft created:>=${day} ${extra}`;
    const [openItems, mergedItems] = await Promise.all([
      searchIssuesPaginated(q("is:open")),
      searchIssuesPaginated(q("is:merged")),
    ]);
    // De-dup by id just in case (same PR shouldn't appear in both, but
    // GitHub indexing drift occasionally does that for freshly-merged PRs).
    const seen = new Set();
    const out = [];
    for (const it of [...openItems, ...mergedItems]) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    return out;
  },

  /**
   * PR body + all comments (conversation + review inline) in one shot.
   * Used by CODE_RUBRIC grading and by the review-timing section/page.
   *
   * Returns:
   *   {
   *     title, body, state,
   *     author, createdAt, mergedAt, htmlUrl, baseRef, headRef,
   *     comments: [{
   *       id, user, body, kind: "issue" | "review",
   *       createdAt,        // ISO string — drives all TTFR/ATTNR math
   *       path?,            // file path the review comment is on
   *       line?,            // 1-based file line (when GitHub returns it)
   *       diffHunk?,        // diff snippet around the comment (review only)
   *       commitId?,        // sha the comment is anchored to
   *       htmlUrl?          // jump-to URL on github.com
   *     }]
   *   }
   *
   * Adding fields here is purely additive — `{ user, body, kind }` callers
   * (grading, classify) keep working unchanged.
   *
   * Drafts are still fetchable here — `myPrsSince` filters them out at the
   * listing step, so a draft only reaches this method if the caller looked
   * it up explicitly.
   */
  pullDetails: async (owner, repo, number) => {
    const base = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const [pr, issueComments, reviewComments] = await Promise.all([
      proxyFetch("github", `${base}/pulls/${number}`),
      proxyFetch("github", `${base}/issues/${number}/comments?per_page=100`),
      proxyFetch("github", `${base}/pulls/${number}/comments?per_page=100`),
    ]);
    const toIssueComment = (c) => ({
      id: c?.id,
      user: c?.user?.login || "unknown",
      body: typeof c?.body === "string" ? c.body : "",
      kind: "issue",
      createdAt: c?.created_at || null,
      htmlUrl: c?.html_url || null,
    });
    const toReviewComment = (c) => ({
      id: c?.id,
      user: c?.user?.login || "unknown",
      body: typeof c?.body === "string" ? c.body : "",
      kind: "review",
      createdAt: c?.created_at || null,
      // GitHub gives us either `line` (preferred, 1-based) or `position`
      // (1-based offset into the diff hunk). Surface whichever we got.
      path: c?.path || null,
      line: c?.line ?? c?.original_line ?? null,
      position: c?.position ?? c?.original_position ?? null,
      diffHunk: typeof c?.diff_hunk === "string" ? c.diff_hunk : "",
      commitId: c?.commit_id || c?.original_commit_id || null,
      htmlUrl: c?.html_url || null,
    });
    return {
      title: pr?.title || "",
      body: typeof pr?.body === "string" ? pr.body : "",
      state: pr?.merged_at ? "merged" : pr?.state || "open",
      author: pr?.user?.login || null,
      createdAt: pr?.created_at || null,
      mergedAt: pr?.merged_at || null,
      htmlUrl: pr?.html_url || null,
      baseRef: pr?.base?.ref || null,
      headRef: pr?.head?.ref || null,
      comments: [
        ...(Array.isArray(issueComments) ? issueComments : []).map(toIssueComment),
        ...(Array.isArray(reviewComments) ? reviewComments : []).map(toReviewComment),
      ],
    };
  },
};
