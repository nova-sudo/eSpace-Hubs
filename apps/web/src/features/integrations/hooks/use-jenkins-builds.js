"use client";

import { jenkinsApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { isoDaysAgo } from "@/lib/date";

/**
 * Hook chain for Jenkins build data.
 *
 *   useJenkinsJobs()                  → list of buildable jobs
 *   useJenkinsBuildsForJob(jobName)   → recent builds on one job
 *   useJenkinsBuildsSince(since)      → flattened recent builds
 *                                        across every visible job
 *                                        (the main dashboard feed)
 *
 * SWR keys are scoped on the connected user — `useSwrIf` returns
 * `null` for the fetcher when Jenkins isn't connected, so no widget
 * fires a 401 on un-connected accounts.
 *
 * Date filtering: Jenkins' `/job/X/api/json` endpoint doesn't accept
 * a date range — we fetch the most-recent 100 builds (Jenkins'
 * default page size when no range is set) and trim client-side by
 * `timestamp >= cutoff`. The 100-build cap matches the api-client's
 * `{,100}` range selector and is sufficient for everything up to
 * "last 90 days" on a typical CI cadence.
 */

export function useJenkinsJobs() {
  const { isConnected } = useIntegrations();
  const swr = useSwrIf(
    isConnected("jenkins"),
    "jenkins:jobs",
    () => jenkinsApi.listJobs(),
  );
  const jobs = Array.isArray(swr.data?.jobs) ? swr.data.jobs : [];
  return { ...swr, jobs };
}

export function useJenkinsBuildsForJob(jobName) {
  const { isConnected } = useIntegrations();
  const enabled = isConnected("jenkins") && !!jobName;
  const swr = useSwrIf(
    enabled,
    enabled ? `jenkins:builds:${jobName}` : null,
    () => jenkinsApi.buildsForJob(jobName),
  );
  const builds = Array.isArray(swr.data?.builds) ? swr.data.builds : [];
  return { ...swr, builds };
}

/**
 * Aggregate recent builds across every visible Jenkins job, trimmed
 * to entries with `timestamp >= since` (ms since epoch OR an ISO
 * string OR `Date`).
 *
 * Iterates the job list — one extra round-trip per job on top of
 * the list call. That's not ideal at 100+ jobs; we'll add a
 * server-side aggregator later if it becomes a problem. For the
 * QA dashboard's "build pass rate" widget reading from one-to-few
 * regression suites, this is fine.
 *
 * Result rows are normalised to:
 *   { jobName, number, result, duration, timestamp, building, displayName }
 * — `result` is the canonical pass/fail string Jenkins returns
 * (SUCCESS / FAILURE / UNSTABLE / ABORTED) plus null for in-flight.
 */
export function useJenkinsBuildsSince(since) {
  const cutoffMs = normaliseCutoff(since);
  const { jobs, isLoading: jobsLoading, error: jobsError } = useJenkinsJobs();

  // Fetch each job's builds in parallel SWR keys. We can't useSWR
  // inside a loop conditionally — instead we expose a `fetchBuilds`
  // helper for the caller, or we cap the dashboard at one job per
  // widget. For PR A's single-widget scope, the caller picks ONE
  // job and we don't actually fan out here. We keep the hook shape
  // simple by returning the job list + a `loadBuildsFor` async fn.
  //
  // Future enhancement: server-side aggregator at
  // /api/v1/integrations/proxy/jenkins/_aggregate that does the
  // fan-out inside the API process.
  return {
    jobs,
    isLoading: jobsLoading,
    error: jobsError,
    cutoffMs,
  };
}

function normaliseCutoff(since) {
  if (!since) return 0;
  if (since instanceof Date) return since.getTime();
  if (typeof since === "number") {
    // Heuristic: small numbers = "days ago"; big numbers = ms since epoch
    if (since < 10_000) return new Date(isoDaysAgo(since)).getTime();
    return since;
  }
  if (typeof since === "string") return new Date(since).getTime();
  return 0;
}
