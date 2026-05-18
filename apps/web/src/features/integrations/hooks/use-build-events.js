"use client";

import { useMemo } from "react";
import { useSwrIf } from "./use-swr-if";
import { useIntegrations } from "../use-integrations";
import { jenkinsApi, githubActionsApi } from "../api-clients";
import {
  normalizeJenkinsBuild,
  normalizeGithubActionsRun,
} from "../metrics/build-events";

/**
 * Unified CI/CD build-events hook.
 *
 *   const { data, isLoading, error } = useBuildEventsSince(source, sinceIso);
 *
 * `source` is the spec.source object: `{ provider, filter, ... }`.
 * The hook selects ONE provider at a time and returns a normalised
 * `BuildEvent[]` (see metrics/build-events.js for the shape).
 *
 * Why a single hook for both providers
 * ────────────────────────────────────
 * Each AUTO widget (DEPLOY_FREQUENCY / LEAD_TIME / BUILD_PASS_RATE)
 * needs the same upstream data — a list of build/run events in a
 * window. Centralising the provider switch here keeps the widget
 * code identical for either provider and lets useDataSource pass a
 * single `data: events` to each metric function downstream.
 *
 * React hook rules
 * ────────────────
 * Both SWR calls are unconditional with a `null` key for the unused
 * provider — useSwrIf short-circuits and doesn't fetch. This mirrors
 * the existing `useMergedByProvider` pattern.
 *
 * Scope requirements
 * ──────────────────
 *   provider = "jenkins"          → source.filter.job MUST be set.
 *                                    Without it we return an empty
 *                                    list — the Review pane shows a
 *                                    "pick a job" picker analogous
 *                                    to the repo picker.
 *   provider = "github_actions"   → source.filter.repo MUST be set.
 *                                    Same idea: no cross-repo Actions
 *                                    feed, so the spec must scope.
 */
export function useBuildEventsSince(source, sinceIso) {
  const { isConnected } = useIntegrations();
  const provider = source?.provider;
  const job = source?.filter?.job;
  const repo = source?.filter?.repo;

  const wantsJenkins =
    provider === "jenkins" && isConnected("jenkins") && !!job;
  const wantsActions =
    provider === "github_actions" && isConnected("github") && !!repo;

  // Jenkins: per-job builds. The api-client returns the most recent
  // ~100 builds; we trim to `sinceIso` client-side because Jenkins
  // doesn't accept a date filter on `/job/.../api/json`.
  const jenkinsSwr = useSwrIf(
    wantsJenkins,
    wantsJenkins ? `jenkins:builds:${job}` : null,
    () => jenkinsApi.buildsForJob(job),
  );

  // GitHub Actions: per-repo workflow runs, scoped server-side via
  // `?created:>=YYYY-MM-DD`. Trim still applies as a defensive guard
  // because the GH cap is calendar-day precision, not ISO datetime.
  const actionsSwr = useSwrIf(
    wantsActions,
    wantsActions ? `gh_actions:runs:${repo}:${sinceIso || ""}` : null,
    () => githubActionsApi.workflowRunsForRepo(repo, isoDate(sinceIso)),
  );

  const cutoffMs = useMemo(
    () => (sinceIso ? Date.parse(sinceIso) : 0),
    [sinceIso],
  );

  const events = useMemo(() => {
    if (wantsJenkins) {
      const builds = Array.isArray(jenkinsSwr.data?.builds)
        ? jenkinsSwr.data.builds
        : [];
      return builds
        .map((b) => normalizeJenkinsBuild(b, job))
        .filter((b) => b && (!cutoffMs || b.ts >= cutoffMs));
    }
    if (wantsActions) {
      const runs = Array.isArray(actionsSwr.data?.workflow_runs)
        ? actionsSwr.data.workflow_runs
        : [];
      return runs
        .map(normalizeGithubActionsRun)
        .filter((e) => e && (!cutoffMs || e.ts >= cutoffMs));
    }
    return [];
  }, [
    wantsJenkins,
    wantsActions,
    jenkinsSwr.data,
    actionsSwr.data,
    job,
    cutoffMs,
  ]);

  // Surface the source-specific scope-missing state separately so
  // widgets can render a "pick a job" / "pick a repo" affordance
  // instead of a generic "no data".
  const needsScope =
    (provider === "jenkins" && !job) ||
    (provider === "github_actions" && !repo);

  return {
    data: events,
    isLoading: wantsJenkins
      ? jenkinsSwr.isLoading
      : wantsActions
        ? actionsSwr.isLoading
        : false,
    error: wantsJenkins
      ? jenkinsSwr.error
      : wantsActions
        ? actionsSwr.error
        : null,
    needsScope,
  };
}

/**
 * GitHub's `created` filter wants `YYYY-MM-DD`, not the full ISO
 * datetime. Slice safely — undefined input → no filter applied.
 */
function isoDate(iso) {
  if (typeof iso !== "string") return undefined;
  return iso.slice(0, 10) || undefined;
}
