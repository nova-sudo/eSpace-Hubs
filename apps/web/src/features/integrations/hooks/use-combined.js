"use client";

import { useMemo } from "react";
import { useGitlabMergedSince } from "./use-gitlab-merged";
import { useGitlabEventsSince } from "./use-gitlab-events";
import { useGithubMergedSince } from "./use-github-merged";
import { useGithubEventsSince } from "./use-github-events";
import { useGithubPrEventsSince } from "./use-github-pr-events";
import {
  buildDemoEvents,
  buildDemoPrs,
  useDemoMode,
} from "@/features/demo-mode";

/**
 * Aggregated "merged PRs in this window" across every connected code host.
 * GitLab MRs keep their native shape; GitHub PRs are normalized to match
 * (see `github-normalize.js`), so the metrics layer sees a single array of
 * records with `merged_at`, `created_at`, `title`, `description`,
 * `source_branch`, `user_notes_count`.
 *
 * The hook doesn't short-circuit on a single source — both queries run in
 * parallel and either can be empty. `isLoading` is true while *any* active
 * source is still fetching; `error` surfaces the first failure.
 *
 * Demo-mode short-circuit: when the user has flipped on demo mode in
 * Settings, both real-source hooks are still called (so toggling back off
 * returns instantly) but the merged data is replaced with the deterministic
 * synthetic dataset. This keeps cache state warm and avoids tearing every
 * downstream tile across the toggle.
 */
export function useCombinedMergedSince(since) {
  const demo = useDemoMode();
  const gl = useGitlabMergedSince(since);
  const gh = useGithubMergedSince(since);
  // Demo dataset is deterministic & cheap — memoize once per session.
  const demoPrs = useMemo(() => (demo ? buildDemoPrs() : null), [demo]);

  if (demo) {
    return {
      data: demoPrs,
      isLoading: false,
      error: null,
      sources: { gitlab: gl, github: gh, demo: true },
    };
  }

  const data =
    gl.data || gh.data ? [...(gl.data || []), ...(gh.data || [])] : undefined;
  return {
    data,
    isLoading: gl.isLoading || gh.isLoading,
    error: gl.error || gh.error || null,
    sources: { gitlab: gl, github: gh },
  };
}

export function useCombinedEventsSince(since) {
  const demo = useDemoMode();
  const gl = useGitlabEventsSince(since);
  const gh = useGithubEventsSince(since);
  // GitHub's /users/:u/events/public hard-caps at 300 events / 90 days
  // and gets fully consumed by recent heavy days. To recover older
  // months we synthesise "opened" / "merged" event-shaped records from
  // the user's PR list (search-issues, no cap). See
  // `use-github-pr-events.js` for the contract + dedup discussion.
  const ghPr = useGithubPrEventsSince(since);
  const demoEvents = useMemo(() => (demo ? buildDemoEvents() : null), [demo]);

  if (demo) {
    return {
      data: demoEvents,
      isLoading: false,
      error: null,
      sources: { gitlab: gl, github: gh, githubPrSynth: ghPr, demo: true },
    };
  }

  const data =
    gl.data || gh.data || ghPr.data
      ? [
          ...(gl.data || []),
          ...(gh.data || []),
          ...(ghPr.data || []),
        ]
      : undefined;
  return {
    data,
    isLoading: gl.isLoading || gh.isLoading || ghPr.isLoading,
    error: gl.error || gh.error || ghPr.error || null,
    sources: { gitlab: gl, github: gh, githubPrSynth: ghPr },
  };
}
