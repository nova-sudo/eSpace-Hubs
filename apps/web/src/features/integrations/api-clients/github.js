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
   */
  myMergedSince: (isoDate) => {
    const day = (isoDate || "").slice(0, 10);
    const q = `is:pr author:@me is:merged merged:>=${day}`;
    return proxyFetch(
      "github",
      `search/issues?q=${encodeURIComponent(q)}&per_page=100`,
    );
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
      // Page wasn't filled → we already have every event GitHub will
      // return; further requests just yield empty arrays.
      if (batch.length < PER_PAGE) break;
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
   * PRs authored by the user since isoDate, INCLUDING both open and merged
   * (but NOT drafts). Used by the CODE_RUBRIC widget to collect the full
   * "year-to-date" set for grading.
   *
   * We run two small searches rather than `is:pr author:@me created:>=...`
   * with no state filter, so each call returns clean results that we don't
   * have to re-filter on the client for draft-state (search-issues doesn't
   * expose the `draft` flag reliably).
   */
  myPrsSince: async (isoDate) => {
    const day = (isoDate || "").slice(0, 10);
    const q = (extra) =>
      `is:pr author:@me -is:draft created:>=${day} ${extra}`;
    const [open, merged] = await Promise.all([
      proxyFetch(
        "github",
        `search/issues?q=${encodeURIComponent(q("is:open"))}&per_page=100`,
      ),
      proxyFetch(
        "github",
        `search/issues?q=${encodeURIComponent(q("is:merged"))}&per_page=100`,
      ),
    ]);
    const openItems = Array.isArray(open?.items) ? open.items : [];
    const mergedItems = Array.isArray(merged?.items) ? merged.items : [];
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
