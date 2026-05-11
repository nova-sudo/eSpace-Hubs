"use client";

import { githubApi } from "../api-clients";
import { useIntegrations } from "../use-integrations";
import { useSwrIf } from "./use-swr-if";
import { isoDaysAgo } from "@/lib/date";

/**
 * Synthesise event-shaped records from the user's PR list.
 *
 * Why this hook exists: `useGithubEventsSince` reads from `/users/:u/
 * events/public`, which GitHub caps at 300 events / ~90 days. For users
 * with heavy daily activity the cap is consumed by recent days, and
 * older months disappear from the events feed entirely (verified on
 * the wire: 299 events all from today for the test account).
 *
 * The search-issues endpoint has no such cap. For each PR the user
 * authored we know:
 *   - created_at  → "PR opened" event
 *   - merged_at   → "PR merged" event (if merged)
 *
 * Both get normalised to the same shape every metric / tile already
 * consumes:
 *   {
 *     created_at:   ISO,
 *     action_name:  "opened" | "merged",
 *     target_type:  "MergeRequest",
 *     target_title: PR title,
 *     repo_name:    "owner/repo",
 *     source:       "github-pr-synth",
 *   }
 *
 * What this CAN'T recover: comment timestamps. The search-issues
 * response only carries a comment COUNT — not the individual
 * timestamps. So Reviews-given for older periods stays limited to
 * whatever lives in the user-events window.
 *
 * Overlap with the real events feed (today's PRs appear in both):
 * intentionally NOT deduped here. The action_name strings differ
 * ("opened" / "merged" here vs. "pushed to" from `normalizeGithubEvents`),
 * so review-comment-targeting metrics (`groupReviewTargets` in the
 * Reviews tile) ignore these synthetic records. Daily-activity tiles
 * will slightly overcount today by the day's PR open/merge count, but
 * that's a small fraction of the events stream — far smaller than the
 * "Apr-Mar shows zero" regression we're fixing.
 */
export function useGithubPrEventsSince(since) {
  const { isConnected } = useIntegrations();
  const iso =
    since instanceof Date
      ? since.toISOString()
      : typeof since === "number"
        ? isoDaysAgo(since)
        : since;
  const swr = useSwrIf(
    isConnected("github"),
    `github:pr-events:${iso}`,
    () => githubApi.myAuthoredPrsSince(iso),
  );
  const synthesised = swr.data ? synthesisePrEvents(swr.data) : swr.data;
  // Apply the same client-side cutoff as the real events hook, in
  // case GitHub returned a PR whose created_at predates the caller's
  // window (search-issues filters by `created:>=DAY` which is
  // day-granular, so a PR created earlier in the boundary day could
  // slip through).
  const cutoff = typeof iso === "string" ? new Date(iso).getTime() : null;
  const data =
    synthesised && cutoff
      ? synthesised.filter(
          (e) => new Date(e.created_at).getTime() >= cutoff,
        )
      : synthesised;
  return { ...swr, data };
}

function synthesisePrEvents(prs) {
  if (!Array.isArray(prs)) return [];
  const out = [];
  for (const it of prs) {
    const repoName =
      typeof it.repository_url === "string"
        ? it.repository_url.split("/").slice(-2).join("/")
        : null;
    const title = it.title || `#${it.number}`;
    if (it.created_at) {
      out.push({
        created_at: it.created_at,
        action_name: "opened",
        target_type: "MergeRequest",
        target_title: title,
        repo_name: repoName,
        source: "github-pr-synth",
      });
    }
    const mergedAt = it.pull_request?.merged_at;
    if (mergedAt) {
      out.push({
        created_at: mergedAt,
        action_name: "merged",
        target_type: "MergeRequest",
        target_title: title,
        repo_name: repoName,
        source: "github-pr-synth",
      });
    }
  }
  return out;
}
