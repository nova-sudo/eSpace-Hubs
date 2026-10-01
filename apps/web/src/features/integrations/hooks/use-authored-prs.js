"use client";

import { useCallback } from "react";
import { githubApi, gitlabApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";

/**
 * The user's authored PRs/MRs since `sinceIso` — the CODE_RUBRIC grading
 * list (GitHub: open + merged, no drafts — `myPrsSince`, two paginated
 * searches; GitLab: every state — `myMrsSince`).
 *
 * One SWR key per provider (`github:graded-prs:<since>`,
 * `gitlab:graded-mrs:<since>`), so every rubric widget, SCORECARD slot and
 * modal on a page shares ONE fetch. It used to be a raw `useEffect` per
 * hook instance — two GitHub searches for each mounted instance.
 *
 * Returns each provider's SWR state plus `refresh()` (revalidates both).
 */
export function useAuthoredPrsSince(sinceIso, { enabled = true } = {}) {
  const { isConnected } = useIntegrations();
  const on = enabled !== false && Boolean(sinceIso);
  const github = useSwrIf(
    on && isConnected("github"),
    `github:graded-prs:${sinceIso}`,
    () => githubApi.myPrsSince(sinceIso),
  );
  const gitlab = useSwrIf(
    on && isConnected("gitlab"),
    `gitlab:graded-mrs:${sinceIso}`,
    () => gitlabApi.myMrsSince(sinceIso),
  );
  const { mutate: mutateGithub } = github;
  const { mutate: mutateGitlab } = gitlab;
  const refresh = useCallback(
    () => Promise.all([mutateGithub(), mutateGitlab()]),
    [mutateGithub, mutateGitlab],
  );
  return {
    github,
    gitlab,
    isLoading: Boolean(github.isLoading || gitlab.isLoading),
    error: github.error || gitlab.error || null,
    refresh,
  };
}
