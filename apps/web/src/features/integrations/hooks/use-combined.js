"use client";

import { useGitlabMergedSince } from "./use-gitlab-merged";
import { useGitlabEventsSince } from "./use-gitlab-events";
import { useGithubMergedSince } from "./use-github-merged";
import { useGithubEventsSince } from "./use-github-events";
import { useGithubPrEventsSince } from "./use-github-pr-events";

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
 */
export function useCombinedMergedSince(since) {
  const gl = useGitlabMergedSince(since);
  const gh = useGithubMergedSince(since);

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
  const gl = useGitlabEventsSince(since);
  const gh = useGithubEventsSince(since);
  // GitHub's /users/:u/events/public hard-caps at 300 events / 90 days
  // and gets fully consumed by recent heavy days. To recover older
  // months we synthesise "opened" / "merged" event-shaped records from
  // the user's PR list (search-issues, no cap). See
  // `use-github-pr-events.js` for the contract + dedup discussion.
  const ghPr = useGithubPrEventsSince(since);

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
