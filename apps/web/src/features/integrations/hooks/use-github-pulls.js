"use client";

import { useMemo } from "react";
import { githubApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import {
  buildDemoPrs,
  buildDemoReviewRequests,
  useDemoMode,
} from "@/features/demo-mode";

/**
 * In demo mode we surface the still-open synthetic PRs through the same
 * hook the real-data path uses, so the Open-PRs tile populates without
 * any code changes downstream.
 *
 * GitHub's search API returns issue-shaped records with `pull_request.html_url`
 * present, plus `state` and `comments`. We synthesize that shape from the
 * demo-PR list filtered to `merged_at == null`.
 */
function buildDemoOpenPulls() {
  const open = buildDemoPrs().filter((p) => !p.merged_at);
  return {
    items: open.map((p) => ({
      id: p.id,
      number: p.number,
      title: p.title,
      html_url: p.web_url,
      state: "open",
      comments: p.user_notes_count,
      created_at: p.created_at,
      pull_request: { html_url: p.web_url },
      // Repo URL embedded in the search-issues shape; downstream parsers
      // expect this when extracting owner/repo for deep-links.
      repository_url: `https://api.github.com/repos/${p.web_url.split("/")[3]}/${p.web_url.split("/")[4]}`,
    })),
  };
}

export function useGithubOpenPulls() {
  const { isConnected } = useIntegrations();
  const demo = useDemoMode();
  const demoData = useMemo(() => (demo ? buildDemoOpenPulls() : null), [demo]);
  const swr = useSwrIf(
    !demo && isConnected("github"),
    "github:my-pulls",
    () => githubApi.myOpenPulls(),
  );
  if (demo) return { data: demoData, isLoading: false, error: null };
  return swr;
}

export function useGithubReviewRequests() {
  const { isConnected } = useIntegrations();
  const demo = useDemoMode();
  const demoData = useMemo(
    () => (demo ? buildDemoReviewRequests() : null),
    [demo],
  );
  const swr = useSwrIf(
    !demo && isConnected("github"),
    "github:review-requests",
    () => githubApi.reviewRequests(),
  );
  if (demo) return { data: demoData, isLoading: false, error: null };
  return swr;
}
