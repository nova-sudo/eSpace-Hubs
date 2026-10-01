"use client";

import { useMemo } from "react";
import { useSWRConfig } from "swr";
import { githubApi } from "../api-clients";
import { mrRepo } from "../metrics/repo-filter";
import { useSwrIf } from "./use-swr-if";
import { createPool, readCachedItem, writeCachedItem } from "./per-item-cache";

/**
 * Hydrate GitHub rows in a normalised merged-MR list with REAL comment
 * counts.
 *
 * Why: `normalizeGithubMergedSearch` maps the search-issues `comments`
 * field into `user_notes_count`, but that field counts issue-thread
 * comments only — inline review comments and review summaries are
 * invisible. Any PR whose feedback arrived as code review reads as 0
 * notes and classifies "clean" in first-pass-rate / avg-rounds.
 *
 * The fix needs one `GET /pulls/{n}` per PR (the detail response carries
 * both `comments` and `review_comments`), which is an N+1 we cap:
 *   - only the CAP most-recent GitHub rows by `merged_at` are hydrated
 *   - fetches share one module-level pool of CONCURRENCY
 *   - each PR's count is its own long-lived cache entry
 *     (`github:pull-count:<id>`): a merged PR's counts don't change, so two
 *     widgets with different repo filters, or yesterday's list plus one new
 *     merge, only fetch the PRs never counted before
 *   - a failed per-PR fetch keeps the search-derived count rather than
 *     failing the batch (and is retried on the next batch)
 * Rows beyond the cap, GitLab rows, and rows we can't locate (no repo
 * slug / number) pass through untouched — GitLab's `user_notes_count`
 * is already correct.
 *
 * Pass `null`/`undefined` to skip entirely (metrics that don't read
 * notes shouldn't spend the rate limit).
 */
const CAP = 30;
const CONCURRENCY = 4;
const pool = createPool(CONCURRENCY);

/** Per-PR cache key — shared by every consumer, whatever its repo filter. */
export function pullCountKey(id) {
  return `github:pull-count:${id}`;
}

export function useGithubReviewCounts(mrs) {
  const swrConfig = useSWRConfig();
  const { mutate } = swrConfig;
  const { targets, beyondCap } = useMemo(() => {
    if (!Array.isArray(mrs)) return { targets: [], beyondCap: 0 };
    const eligible = mrs
      .filter((m) => m?.source === "github" && m.number && mrRepo(m))
      .sort(
        (a, b) =>
          new Date(b.merged_at || 0).getTime() -
          new Date(a.merged_at || 0).getTime(),
      );
    return {
      targets: eligible.slice(0, CAP),
      beyondCap: Math.max(0, eligible.length - CAP),
    };
  }, [mrs]);

  const key =
    targets.length > 0
      ? `github:pull-counts:${targets
          .map((m) => m.id)
          .sort()
          .join(",")}`
      : null;

  const swr = useSwrIf(
    Boolean(key),
    key,
    async () => {
      const counts = {};
      await Promise.all(
        targets.map(async (m) => {
          const cached = readCachedItem(swrConfig, pullCountKey(m.id));
          if (typeof cached === "number") {
            counts[m.id] = cached;
            return;
          }
          const slug = mrRepo(m);
          const slash = slug.indexOf("/");
          const owner = slug.slice(0, slash);
          const repo = slug.slice(slash + 1);
          try {
            const c = await pool(() => githubApi.pullCounts(owner, repo, m.number));
            counts[m.id] = c.comments + c.reviewComments;
            writeCachedItem(mutate, pullCountKey(m.id), counts[m.id]);
          } catch {
            // Keep the search-derived count for this row; not cached, so
            // the next batch asks again.
          }
        }),
      );
      return counts;
    },
    // The batch is assembled from immutable per-PR entries; re-running it
    // on every remount would only re-read the cache. A new id set is a new
    // key, and the refresh chip still revalidates explicitly.
    { revalidateIfStale: false },
  );

  const data = useMemo(() => {
    if (!Array.isArray(mrs)) return mrs;
    const counts = swr.data;
    if (!counts) return mrs;
    return mrs.map((m) =>
      counts[m?.id] != null ? { ...m, user_notes_count: counts[m.id] } : m,
    );
  }, [mrs, swr.data]);

  // `beyondCap` — GitHub rows past the hydration cap whose note counts are
  // still the (undercounting) search-issue numbers. Provenance surfaces
  // this instead of letting the widget present a partially-hydrated rate
  // with full confidence.
  return {
    data,
    isLoading: Boolean(key) && swr.isLoading,
    error: swr.error || null,
    beyondCap,
    fetchedAt: swr.fetchedAt ?? null,
  };
}
