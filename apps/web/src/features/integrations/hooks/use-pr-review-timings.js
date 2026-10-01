"use client";

import useSWR, { useSWRConfig } from "swr";
import { useCallback, useMemo } from "react";
import { useCombinedMergedSince } from "./use-combined";
import { githubApi } from "../api-clients/github";
import { gitlabApi } from "../api-clients/gitlab";
import { parseGitlabLocator } from "../api-clients/gitlab-normalize";
import { computePrReviewTiming } from "../metrics/review-timing";
import { createPool } from "./per-item-cache";

/**
 * Review timings (TTFR, ATTNR, idle) for merged PRs/MRs — loaded PER PR,
 * lazily.
 *
 * The Reviews log used to fetch every merged PR's conversation + review
 * comments up front (GitHub: 3 calls per PR, GitLab: 2) before painting a
 * single row — ~600 GitHub requests for the 12-month preset. Now:
 *
 *   - `useReviewablePrs(since)` returns the merged list as lightweight rows
 *     straight away (no per-PR calls);
 *   - `usePrReviewTiming(row)` loads ONE PR's details. The page mounts it
 *     only for the rows it shows (a capped page plus "Load more") and for
 *     the selected PR, so the fan-out is bounded by what's on screen.
 *
 * Each PR is its own SWR entry (`github:pr-details:<owner>/<repo>#<n>`,
 * `gitlab:mr-details:<project>!<iid>`). A MERGED PR's thread is effectively
 * immutable, so the entry is long-lived: no revalidation on remount, a 24h
 * dedupe, and — when the app's SWR cache is persisted — it survives reloads
 * (this replaces the old single-slot localStorage day cache, which one
 * preset switch overwrote). All detail fetches share one module-level pool
 * of CONCURRENCY so a page of rows mounting together can't trip GitHub's
 * secondary limits.
 */

const CONCURRENCY = 4;
const pool = createPool(CONCURRENCY);

const LONG_LIVED = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateIfStale: false,
  shouldRetryOnError: false,
  dedupingInterval: 24 * 60 * 60_000,
};

/**
 * Parse `{owner, repo, number}` out of a GitHub merged-PR record.
 *
 * GitHub web_url shape: `https://github.com/{owner}/{repo}/pull/{n}`
 * (issue search returns this as `html_url`; the normalizer passes it
 * through as `web_url`). Returns null for non-GitHub URLs.
 */
export function parseGithubLocator(pr) {
  const url = pr?.web_url || "";
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

/**
 * A lightweight review-log row for one merged PR/MR — everything the list
 * needs without a details fetch. `detailsKey` is null when the record can't
 * be located (no parseable URL / project id); such a row renders without
 * timings rather than failing the page.
 */
export function reviewRowFromMr(mr) {
  if (!mr) return null;
  if (mr.source === "gitlab") {
    const loc = parseGitlabLocator(mr);
    const slug = typeof mr.web_url === "string"
      ? (/^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\//.exec(mr.web_url)?.[1] ?? null)
      : null;
    return {
      id: mr.id,
      number: mr.number ?? mr.iid ?? loc?.iid ?? null,
      title: mr.title || "",
      htmlUrl: mr.web_url || null,
      owner: null,
      repo: slug,
      createdAt: mr.created_at || null,
      mergedAt: mr.merged_at || null,
      author: mr.author?.username || null,
      source: "gitlab",
      detailsKey: loc ? `gitlab:mr-details:${loc.projectId}!${loc.iid}` : null,
      locator: loc,
    };
  }
  const loc = parseGithubLocator(mr);
  return {
    id: mr.id,
    number: mr.number ?? loc?.number ?? null,
    title: mr.title || "",
    htmlUrl: mr.web_url || null,
    owner: loc?.owner ?? null,
    repo: loc?.repo ?? null,
    createdAt: mr.created_at || null,
    mergedAt: mr.merged_at || null,
    author: null,
    source: "github",
    detailsKey: loc ? `github:pr-details:${loc.owner}/${loc.repo}#${loc.number}` : null,
    locator: loc,
  };
}

/** Newest merge first — the order the review log pages through. */
export function sortRowsNewestFirst(rows) {
  return [...rows].sort((a, b) => {
    const am = a.mergedAt ? Date.parse(a.mergedAt) : 0;
    const bm = b.mergedAt ? Date.parse(b.mergedAt) : 0;
    return bm - am;
  });
}

/**
 * Merged PRs/MRs since `since`, as review-log rows. No per-PR requests —
 * pair with `usePrReviewTiming` for the rows actually on screen.
 */
export function useReviewablePrs(since) {
  const { data, isLoading, error } = useCombinedMergedSince(since);
  const rows = useMemo(
    () => (Array.isArray(data) ? sortRowsNewestFirst(data.map(reviewRowFromMr).filter(Boolean)) : undefined),
    [data],
  );
  return { data: rows, isLoading: Boolean(isLoading) && !rows, error: error || null };
}

async function fetchRowDetails(row) {
  if (row.source === "gitlab") {
    return gitlabApi.mrDetails(row.locator.projectId, row.locator.iid);
  }
  return githubApi.pullDetails(row.locator.owner, row.locator.repo, row.locator.number);
}

/**
 * One PR's details + computed review timing. Pass `enabled: false` (or a
 * null row) to skip. Returns `{ item, isLoading, error, retry }` where
 * `item` is `{ pr, details, timing }` — the shape the review log renders —
 * or null until the details resolve.
 */
export function usePrReviewTiming(row, { enabled = true } = {}) {
  const key = enabled && row?.detailsKey ? row.detailsKey : null;
  const swr = useSWR(key, () => pool(() => fetchRowDetails(row)), LONG_LIVED);
  const { mutate } = swr;
  const item = useMemo(() => {
    if (!row) return null;
    const details = swr.data || null;
    if (!details) return null;
    const timing = computePrReviewTiming(
      { createdAt: details.createdAt || row.createdAt, author: details.author },
      details.comments || [],
    );
    return {
      pr: {
        ...row,
        title: row.title || details.title || "",
        htmlUrl: row.htmlUrl || details.htmlUrl || null,
        createdAt: details.createdAt || row.createdAt,
        mergedAt: details.mergedAt || row.mergedAt,
        author: details.author || row.author,
      },
      details,
      timing,
    };
  }, [row, swr.data]);
  const retry = useCallback(() => mutate(), [mutate]);
  return {
    item,
    isLoading: Boolean(key) && !swr.data && !swr.error,
    error: swr.error || null,
    retry,
  };
}

/**
 * Revalidate the merged-list keys behind the review log (the list-level
 * "Retry"). Only mounted keys refetch; per-PR details are left alone.
 */
export function useRetryReviewList() {
  const { mutate } = useSWRConfig();
  return useCallback(
    () =>
      mutate(
        (key) =>
          typeof key === "string" &&
          (key.startsWith("github:merged:") || key.startsWith("gitlab:merged:")),
      ),
    [mutate],
  );
}
