import { proxyFetch } from "./proxy-fetch";

/**
 * GitHub Actions REST client.
 *
 * Re-uses the same encrypted-proxy path as the rest of the GitHub
 * integration (`/api/v1/integrations/proxy/github/...`), but hits the
 * Actions endpoints. The GitHub OAuth `repo` scope already grants
 * read on workflow runs — no new auth flow.
 *
 * Why a separate client file vs. piling onto `github.js`:
 *   - The Actions REST surface is its own conceptual area (runs,
 *     workflows, artifacts) that the AUTO widgets only care about
 *     in aggregate. Splitting it keeps PR-flavoured fetches (PRs,
 *     events) out of D3 widget code paths.
 *   - When we later add a /actions hook chain (in-flight indicator,
 *     latest-run-per-branch chip, etc.) it lives next to this file
 *     instead of bloating github.js further.
 *
 * Scope: per-repo. GitHub doesn't expose an "all my workflow runs"
 * endpoint — runs are always scoped to one owner/name. The hook
 * gates on `source.filter.repo` being set; until the user picks a
 * repo the widget renders a "needs repo scope" placeholder.
 */
export const githubActionsApi = {
  /**
   * Workflow runs for a single repo, newest first, optionally
   * filtered by `created:>=YYYY-MM-DD`. Returns the raw GitHub
   * envelope `{ total_count, workflow_runs: [...] }`.
   *
   * Page size capped at 100 (GitHub's max). For a 30/90-day window
   * with multiple-per-day deploys that's enough; if a repo blows
   * past 100 runs in the window we'll add pagination later — the
   * trim-by-timestamp in the metric layer keeps it honest in the
   * meantime.
   *
   * The `repo` argument must be `"owner/name"`. The function
   * intentionally doesn't accept owner+name pairs separately —
   * matching the `mrRepo()` slug shape from the Phase B repo-filter
   * module so the same slug can drive both PR-based and Actions
   * widgets.
   */
  workflowRunsForRepo: (repo, isoSince) => {
    const slug = String(repo || "").trim();
    if (!slug) {
      return Promise.reject(
        new Error("github_actions: repo slug is required"),
      );
    }
    const params = new URLSearchParams({ per_page: "100" });
    if (isoSince) {
      // The API takes `created:>=...`. Pre-encoding the colon trips
      // up the proxy on some setups, so let URLSearchParams handle
      // the escaping.
      params.set("created", `>=${isoSince}`);
    }
    return proxyFetch(
      "github",
      `repos/${encodeURI(slug)}/actions/runs?${params.toString()}`,
    );
  },
};
