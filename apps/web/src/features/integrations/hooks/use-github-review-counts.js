"use client";

import { useMemo } from "react";
import { githubApi } from "../api-clients";
import { mrRepo } from "../metrics/repo-filter";
import { useSwrIf } from "./use-swr-if";

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
 *   - fetches run at most CONCURRENCY at a time
 *   - the whole batch is one SWR entry keyed on the target ids, so a
 *     re-render (or a sibling widget on the same spec) reuses it
 *   - a failed per-PR fetch keeps the search-derived count rather than
 *     failing the batch
 * Rows beyond the cap, GitLab rows, and rows we can't locate (no repo
 * slug / number) pass through untouched — GitLab's `user_notes_count`
 * is already correct.
 *
 * Pass `null`/`undefined` to skip entirely (metrics that don't read
 * notes shouldn't spend the rate limit).
 */
const CAP = 30;
const CONCURRENCY = 4;

export function useGithubReviewCounts(mrs) {
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

  const swr = useSwrIf(Boolean(key), key, async () => {
    const counts = {};
    let next = 0;
    const worker = async () => {
      while (next < targets.length) {
        const m = targets[next++];
        const slug = mrRepo(m);
        const slash = slug.indexOf("/");
        const owner = slug.slice(0, slash);
        const repo = slug.slice(slash + 1);
        try {
          const c = await githubApi.pullCounts(owner, repo, m.number);
          counts[m.id] = c.comments + c.reviewComments;
        } catch {
          // Keep the search-derived count for this row.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker),
    );
    return counts;
  });

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
