import { proxyFetch } from "./proxy-fetch";

/**
 * Jenkins REST client. All requests go through the encrypted-at-rest
 * proxy at /api/v1/integrations/proxy/jenkins/* — the API service
 * decrypts the API token in-process and forwards. The browser never
 * sees the token after the M6 encryption boundary.
 *
 * Path shape: Jenkins resources don't share a common `/api/` prefix
 * the way GitHub/GitLab/Jira do. Each resource has its OWN `/api/json`
 * suffix — e.g. `/api/json` (root), `/job/<name>/api/json`,
 * `/job/<name>/lastBuild/api/json`. We pass the literal path each time.
 *
 * Tree selectors: Jenkins payloads are heavy by default (every plugin
 * adds fields). We pass `?tree=...` to project only what we need.
 * Reduces 100KB+ responses to ~2KB and is mandatory on large instances.
 */
export const jenkinsApi = {
  /**
   * Instance metadata — used by the connect form to verify the
   * credentials work. Equivalent of "ping": no specific job needed,
   * any valid Basic-auth pair gets a 200 with the controller's name.
   */
  me: () => proxyFetch("jenkins", "api/json?tree=mode,nodeDescription"),

  /**
   * List every top-level job on the controller. Used by the QA
   * dashboard to surface "what suites does this user actually have
   * access to?" and to enumerate per-job stats.
   *
   * Tree-projected to `jobs[name,url,color,buildable]` — `color`
   * encodes the latest-build status (e.g. `blue` = success,
   * `red` = failure, `yellow` = unstable, `*_anime` = currently
   * building). Keeps the response under ~10KB even on a busy
   * controller with hundreds of jobs.
   */
  listJobs: () =>
    proxyFetch(
      "jenkins",
      "api/json?tree=jobs[name,url,color,buildable]",
    ),

  /**
   * Build history for one job. Returns the most recent ~100 builds
   * with the fields needed for pass/fail/duration analytics.
   *
   * Fields:
   *   - number          monotonic build number
   *   - result          SUCCESS / FAILURE / UNSTABLE / ABORTED / null
   *                       (null = in-flight; treat as pending)
   *   - duration        ms; 0 while building
   *   - timestamp       unix epoch ms of build start
   *   - building        true while in-flight
   *   - displayName     human-readable label ("#42 (master)" etc.)
   *
   * Jenkins doesn't have a date-range filter on this endpoint —
   * caller trims by timestamp client-side.
   *
   * Note: `{,100}` is Jenkins' range selector syntax for "first 100".
   * Without it the response can balloon to thousands of builds on
   * long-lived jobs.
   */
  buildsForJob: (jobName) =>
    proxyFetch(
      "jenkins",
      `job/${encodeURIComponent(jobName)}/api/json?tree=builds[number,result,duration,timestamp,building,displayName]{,100}`,
    ),
};
