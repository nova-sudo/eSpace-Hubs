import { proxyFetch } from "./proxy-fetch";
import { readIntegrations } from "../integrations-store";

/**
 * Page through a GitLab list endpoint until a short page comes back
 * (fewer than a full page = the last page) or we hit the page ceiling.
 *
 * Mirrors the GitHub `searchIssuesPaginated` fix: the snapshot "merged"
 * count and the weekly buckets in `synthesiseWeek` need the author's FULL
 * backfill window (a year). The previous single `per_page=100` call got
 * fully consumed by the two most recent weeks for a heavy author, so every
 * older week synthesised as 0 merged even though the MRs existed.
 *
 * 10 pages = 1000 MRs, matching GitHub's search ceiling. `buildPath(page)`
 * returns the endpoint path for a given 1-based page. Pages are fetched
 * serially to stay friendly to the proxy's rate limits.
 */
const GL_PER_PAGE = 100;
const GL_MAX_PAGES = 10; // 1000 MRs — matches GitHub's search ceiling
async function gitlabPaginate(buildPath) {
  const out = [];
  for (let page = 1; page <= GL_MAX_PAGES; page++) {
    const batch = await proxyFetch("gitlab", buildPath(page));
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < GL_PER_PAGE) break;
  }
  return out;
}

export const gitlabApi = {
  me: () => proxyFetch("gitlab", "user"),

  myOpenMRs: () =>
    proxyFetch("gitlab", "merge_requests?scope=created_by_me&state=opened&per_page=50"),

  /** MRs awaiting the current user's review — requires a known username. */
  reviewRequests: () => {
    const username = readIntegrations().gitlab?.username;
    if (!username) {
      throw new Error("GitLab username unknown — reconnect to populate it");
    }
    return proxyFetch(
      "gitlab",
      `merge_requests?reviewer_username=${encodeURIComponent(username)}&state=opened&per_page=50`,
    );
  },

  /**
   * MRs I authored that merged since a given ISO date.
   *
   * Paginated (see `gitlabPaginate`) so heavy authors get their full year
   * of merged MRs, not just the most recent 100. This list drives the
   * snapshot "merged" count and the per-week buckets in `synthesiseWeek`.
   */
  myMergedSince: (isoDate) =>
    gitlabPaginate(
      (page) =>
        `merge_requests?scope=created_by_me&state=merged&updated_after=${encodeURIComponent(isoDate)}&per_page=${GL_PER_PAGE}&page=${page}&order_by=created_at&sort=desc`,
    ),

  /** Current user's activity events since a date (yyyy-mm-dd). */
  myEventsSince: (isoDate) =>
    proxyFetch(
      "gitlab",
      `events?after=${encodeURIComponent(isoDate.slice(0, 10))}&per_page=100`,
    ),
};
