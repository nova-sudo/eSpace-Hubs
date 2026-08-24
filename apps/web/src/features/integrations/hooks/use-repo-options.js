"use client";

import { useMemo } from "react";
import { githubApi, gitlabApi } from "../api-clients";
import { listReposFromMrs } from "../metrics/repo-filter";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { useCombinedMergedSince } from "./use-combined";
import { startOfYearIso } from "@/lib/date";

/**
 * Option list for the BYO repo picker.
 *
 * Two sources, merged:
 *   - the provider list APIs (`user/repos` / `projects?membership=true`)
 *     for the COMPLETE set of repos the user can reach, including ones
 *     they haven't merged into yet;
 *   - `listReposFromMrs` over the YTD merged feed, which marks the repos
 *     the user actively works in — those are pinned first in the picker.
 *
 * Returns `{ options, recentSet, isLoading, connected }`:
 *   options   — de-duped lower-case slugs, recent-first then alphabetical
 *   recentSet — Set of slugs that came from the merged feed
 *   connected — true when at least one code host is connected (the
 *               picker falls back to free-text entry when false)
 *
 * Per-provider fetches are skipped when that provider isn't connected,
 * and a provider list that errors just drops out of the union — the
 * picker must degrade to "what we know", never block on a flaky host.
 */
export function useRepoOptions() {
  const { isConnected } = useIntegrations();
  const githubConnected = isConnected("github");
  const gitlabConnected = isConnected("gitlab");
  const connected = githubConnected || gitlabConnected;

  const githubRepos = useSwrIf(githubConnected, "github:repos", () =>
    githubApi.myRepos(),
  );
  const gitlabProjects = useSwrIf(gitlabConnected, "gitlab:projects", () =>
    gitlabApi.myProjects(),
  );
  const merged = useCombinedMergedSince(connected ? startOfYearIso() : null);

  const { options, recentSet } = useMemo(() => {
    const recent = listReposFromMrs(merged.data || []);
    const recentSet = new Set(recent);
    const listed = [
      ...(Array.isArray(githubRepos.data) ? githubRepos.data : []),
      ...(Array.isArray(gitlabProjects.data) ? gitlabProjects.data : []),
    ];
    const rest = [...new Set(listed)]
      .filter((slug) => !recentSet.has(slug))
      .sort();
    return { options: [...recent, ...rest], recentSet };
  }, [merged.data, githubRepos.data, gitlabProjects.data]);

  return {
    options,
    recentSet,
    isLoading:
      Boolean(githubRepos.isLoading) ||
      Boolean(gitlabProjects.isLoading) ||
      Boolean(merged.isLoading),
    connected,
  };
}
