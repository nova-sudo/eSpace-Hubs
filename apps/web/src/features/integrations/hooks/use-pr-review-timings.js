"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { useCombinedMergedSince } from "./use-combined";
import { githubApi } from "../api-clients/github";
import { computePrReviewTiming } from "../metrics/review-timing";
import {
  buildDemoDetailsMap,
  buildDemoPrs,
  useDemoMode,
} from "@/features/demo-mode";

/**
 * For every merged PR in the window, fetch its conversation + review-line
 * comments and compute review-timing stats (TTFR, ATTNR, idle).
 *
 * GitHub-only today — GitLab MRs are surfaced in the list but skipped for
 * details (their REST shape is different and needs a separate adapter).
 * The tile/page label "GitHub PRs" reflects this; GitLab support can plug
 * in later by extending `parseGithubLocator` and the fetch branch.
 *
 * Network discipline:
 *   - One SWR cache entry keyed by the sorted PR ids in the window. Same
 *     window across tiles → one fetch.
 *   - Bounded concurrency (`CONCURRENCY`) so we don't hammer GitHub's
 *     5000-req/hr secondary limit when the user has 30+ merged PRs.
 *   - Per-PR errors are isolated: a failing PR yields `null` and the rest
 *     still come back. The aggregate metric just ignores nulls.
 */

const CONCURRENCY = 4;

export function usePrReviewTimings(since) {
  const demo = useDemoMode();

  // ── ALL hooks must be called unconditionally on every render. We
  //    compute both the demo-mode result and the live-data SWR result,
  //    then return one or the other at the end. The cost of the unused
  //    branch is negligible (SWR's `null` key is a no-op fetch; demo
  //    memo is cheap synthetic generation).

  // Demo-mode synthetic timings, computed once per toggle.
  const demoTimings = useMemo(() => {
    if (!demo) return null;
    const prs = buildDemoPrs();
    const details = buildDemoDetailsMap();
    return prs
      .map((pr) => {
        const d = details.get(pr.id);
        if (!d) return null;
        const timing = computePrReviewTiming(
          { createdAt: d.createdAt, author: d.author },
          d.comments || [],
        );
        const loc = parseOwnerRepoFromUrl(pr.web_url) || {
          owner: "demo",
          repo: "demo",
        };
        return {
          pr: {
            id: pr.id,
            number: pr.number,
            title: pr.title,
            htmlUrl: pr.web_url,
            owner: loc.owner,
            repo: loc.repo,
            createdAt: d.createdAt,
            mergedAt: d.mergedAt,
            author: d.author,
            source: "github",
          },
          details: d,
          timing,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const am = a.pr.mergedAt ? Date.parse(a.pr.mergedAt) : 0;
        const bm = b.pr.mergedAt ? Date.parse(b.pr.mergedAt) : 0;
        return bm - am;
      });
  }, [demo]);

  // Live-data path — runs on every render, but useCombinedMergedSince
  // itself short-circuits to demo data when demo is on, so it stays cheap.
  const { data: prs, isLoading: listLoading, error: listError } =
    useCombinedMergedSince(since);

  // Stable key — sorted PR ids — so SWR re-fetches only when the window or
  // the PR set actually changes, not on every render.
  const ghPrs = (prs || []).filter((p) => p.source === "github");
  const idsKey = ghPrs
    .map((p) => p.id)
    .filter(Boolean)
    .sort()
    .join(",");
  const swrKey = idsKey ? `pr-review-timings:${idsKey}` : null;

  const swr = useSWR(
    swrKey,
    async () => {
      const tasks = ghPrs
        .map((pr) => {
          const loc = parseGithubLocator(pr);
          if (!loc) return null;
          return { pr, loc };
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
            const { pr, loc } = tasks[i];
            try {
              const details = await githubApi.pullDetails(
                loc.owner,
                loc.repo,
                loc.number,
              );
              const timing = computePrReviewTiming(
                {
                  createdAt: details.createdAt || pr.created_at,
                  author: details.author,
                },
                details.comments || [],
              );
              out.push({
                pr: {
                  id: pr.id,
                  number: pr.number || loc.number,
                  title: pr.title || details.title || "",
                  htmlUrl: pr.web_url || details.htmlUrl || null,
                  owner: loc.owner,
                  repo: loc.repo,
                  createdAt: details.createdAt || pr.created_at,
                  mergedAt: details.mergedAt || pr.merged_at,
                  author: details.author,
                  source: "github",
                },
                details,
                timing,
              });
            } catch {
              out.push({
                pr: {
                  id: pr.id,
                  number: pr.number || loc.number,
                  title: pr.title || "",
                  htmlUrl: pr.web_url || null,
                  owner: loc.owner,
                  repo: loc.repo,
                  createdAt: pr.created_at,
                  mergedAt: pr.merged_at,
                  author: null,
                  source: "github",
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
      // PR comments don't move once a PR is merged — cache for 5 min.
      dedupingInterval: 5 * 60_000,
    },
  );

  if (demo) {
    return { data: demoTimings, isLoading: false, error: null };
  }
  return {
    data: swr.data,
    isLoading: listLoading || (!!swrKey && !swr.data && !swr.error),
    error: listError || swr.error || null,
  };
}

/** Local helper — used only by the demo path to fill `pr.owner` / `pr.repo`. */
function parseOwnerRepoFromUrl(url) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url || "");
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * Parse `{owner, repo, number}` out of the merged-PR record.
 *
 * GitHub web_url shape: `https://github.com/{owner}/{repo}/pull/{n}`
 * (issue search returns this directly as `html_url`; the normalizer
 * passes it through as `web_url`.)
 */
export function parseGithubLocator(pr) {
  const url = pr?.web_url || "";
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}
