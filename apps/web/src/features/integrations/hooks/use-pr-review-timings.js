"use client";

import useSWR from "swr";
import { useCombinedMergedSince } from "./use-combined";
import { githubApi } from "../api-clients/github";
import { gitlabApi } from "../api-clients/gitlab";
import { parseGitlabLocator } from "../api-clients/gitlab-normalize";
import { computePrReviewTiming } from "../metrics/review-timing";

/**
 * For every merged PR/MR in the window, fetch its conversation + review
 * comments and compute review-timing stats (TTFR, ATTNR, idle).
 *
 * Provider-agnostic: each item in the combined merged list is routed to
 * its own provider's details fetch — `githubApi.pullDetails` for GitHub
 * PRs, `gitlabApi.mrDetails` for GitLab MRs — both of which return the
 * SAME normalized `{ createdAt, author, comments:[{user,createdAt,…}] }`
 * shape, so `computePrReviewTiming` consumes them identically. A GitLab-
 * only user now gets the same review-timing section a GitHub user does.
 *
 * Network discipline:
 *   - One SWR cache entry keyed by the sorted item ids in the window.
 *     Same window across tiles → one fetch.
 *   - Bounded concurrency (`CONCURRENCY`) so a 30+ MR/PR window doesn't
 *     hammer a provider's secondary rate limit (and proxyFetch's
 *     rate-limit wait/resume backs that up).
 *   - Per-item errors are isolated: a failing item yields a null timing
 *     and the rest still come back; the aggregate ignores nulls.
 */

const CONCURRENCY = 4;

export function usePrReviewTimings(since) {
  const { data: prs, isLoading: listLoading, error: listError } =
    useCombinedMergedSince(since);

  const list = prs || [];
  // Stable key — sorted ids across BOTH providers — so SWR re-fetches
  // only when the window or the item set actually changes.
  const idsKey = list
    .map((p) => p.id)
    .filter(Boolean)
    .sort()
    .join(",");
  const swrKey = idsKey ? `pr-review-timings:${idsKey}` : null;

  const swr = useSWR(
    swrKey,
    async () => {
      // Build a per-item task carrying a provider-specific details
      // fetcher. Items we can't locate (no parseable locator) are
      // dropped rather than failing the batch.
      const tasks = list
        .map((pr) => {
          if (pr?.source === "gitlab") {
            const loc = parseGitlabLocator(pr);
            if (!loc) return null;
            return {
              pr,
              source: "gitlab",
              owner: null,
              repo: null,
              number: pr.number ?? loc.iid,
              fetchDetails: () => gitlabApi.mrDetails(loc.projectId, loc.iid),
            };
          }
          // Default to GitHub (source "github" or legacy untagged).
          const loc = parseGithubLocator(pr);
          if (!loc) return null;
          return {
            pr,
            source: "github",
            owner: loc.owner,
            repo: loc.repo,
            number: pr.number ?? loc.number,
            fetchDetails: () =>
              githubApi.pullDetails(loc.owner, loc.repo, loc.number),
          };
        })
        .filter(Boolean);

      const out = [];
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, tasks.length) },
        async () => {
          while (true) {
            const i = cursor++;
            if (i >= tasks.length) return;
            const t = tasks[i];
            try {
              const details = await t.fetchDetails();
              const timing = computePrReviewTiming(
                {
                  createdAt: details.createdAt || t.pr.created_at,
                  author: details.author,
                },
                details.comments || [],
              );
              out.push({
                pr: {
                  id: t.pr.id,
                  number: t.number,
                  title: t.pr.title || details.title || "",
                  htmlUrl: t.pr.web_url || details.htmlUrl || null,
                  owner: t.owner,
                  repo: t.repo,
                  createdAt: details.createdAt || t.pr.created_at,
                  mergedAt: details.mergedAt || t.pr.merged_at,
                  author: details.author,
                  source: t.source,
                },
                details,
                timing,
              });
            } catch {
              out.push({
                pr: {
                  id: t.pr.id,
                  number: t.number,
                  title: t.pr.title || "",
                  htmlUrl: t.pr.web_url || null,
                  owner: t.owner,
                  repo: t.repo,
                  createdAt: t.pr.created_at,
                  mergedAt: t.pr.merged_at,
                  author: null,
                  source: t.source,
                },
                details: null,
                timing: null,
              });
            }
          }
        },
      );
      await Promise.all(workers);
      // Keep newest-merged first — matches the rest of the dashboard.
      out.sort((a, b) => {
        const am = a.pr.mergedAt ? Date.parse(a.pr.mergedAt) : 0;
        const bm = b.pr.mergedAt ? Date.parse(b.pr.mergedAt) : 0;
        return bm - am;
      });
      return out;
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      // PR/MR comments don't move once merged — cache for 5 min.
      dedupingInterval: 5 * 60_000,
    },
  );

  return {
    data: swr.data,
    isLoading: listLoading || (!!swrKey && !swr.data && !swr.error),
    error: listError || swr.error || null,
  };
}

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
