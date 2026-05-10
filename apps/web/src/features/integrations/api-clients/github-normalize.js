/**
 * GitHub → GitLab-shape adapters.
 *
 * The metrics layer (merged / turnaround / rounds / linkage / reviews /
 * activity) was written against GitLab's MR and Event shapes. Rather than
 * branching every metric on provider, we normalize GitHub responses to the
 * same contract:
 *
 *   MR-shape:   { merged_at, created_at, title, description, source_branch, user_notes_count, source }
 *   Event-shape:{ created_at, action_name, target_type, source }
 *
 * `source` lets tiles distinguish origin if ever needed; metrics ignore it.
 */

/**
 * Normalize a response from `GET /search/issues?q=is:pr+is:merged+...`
 * into the GitLab merged-MR shape.
 *
 * GitHub's search-issues endpoint returns PRs with:
 *   - title, body, created_at, number, comments
 *   - pull_request.merged_at (only on PR hits that are merged)
 *
 * `source_branch` isn't in search results. Linkage falls back to title + body,
 * which is enough for our conventions (branch and PR title both carry ESD-XXX).
 */
export function normalizeGithubMergedSearch(resp) {
  const items = Array.isArray(resp) ? resp : resp?.items || [];
  return items
    .map((it) => {
      const mergedAt = it.pull_request?.merged_at || it.closed_at;
      if (!mergedAt) return null;
      return {
        // GitLab-shape fields the metrics & tiles read:
        id: `gh-${it.id}`,
        iid: it.number,
        merged_at: mergedAt,
        created_at: it.created_at,
        title: it.title || "",
        description: it.body || "",
        source_branch: "",
        user_notes_count: it.comments || 0,
        web_url: it.html_url,
        source: "github",
        // Raw number kept for GitHub-specific rendering:
        number: it.number,
      };
    })
    .filter(Boolean);
}

/**
 * Normalize `GET /users/:u/events/public` response into GitLab event shape.
 *
 * PR-comment-ish events (IssueCommentEvent on a PR, PullRequestReviewEvent,
 * PullRequestReviewCommentEvent) are mapped to action_name:"commented on" +
 * target_type:"MergeRequest" so that `countMrComments` picks them up.
 *
 * All other events keep their `created_at` for daily activity buckets.
 */
export function normalizeGithubEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map((ev) => {
    const t = ev.type || "";
    const isPrComment =
      t === "PullRequestReviewCommentEvent" ||
      t === "PullRequestReviewEvent" ||
      (t === "IssueCommentEvent" && ev.payload?.issue?.pull_request);
    const isPush = t === "PushEvent";
    // GitHub's public events feed collapses PR merges into a bespoke
    // `action: "merged"` rather than the documented `closed` + `merged: true`
    // pair. We accept both — and note that `pull_request` in the public feed
    // is stripped down (no title / merge_commit_sha / merged flag).
    const isMergedPr =
      t === "PullRequestEvent" &&
      (ev.payload?.action === "merged" ||
        (ev.payload?.action === "closed" && ev.payload?.pull_request?.merged));

    const out = {
      created_at: ev.created_at,
      action_name: isPrComment
        ? "commented on"
        : isPush || isMergedPr
          ? "pushed to"
          : t.replace(/Event$/, ""),
      target_type: isPrComment ? "MergeRequest" : null,
      repo_name: ev.repo?.name || null,
      source: "github",
    };

    // Mirror GitLab's `push_data` shape so the commits tile works unchanged.
    //
    // Note: GitHub leaves `payload.commits` empty when commits were created
    // via the REST Git Data API (POST /git/commits + POST /git/refs) instead
    // of `git push`. In that case we still want a usable label, so we fall
    // back to the branch name from `ref` and the head sha.
    if (isPush) {
      const commits = ev.payload?.commits || [];
      const last = commits[commits.length - 1];
      const branch = (ev.payload?.ref || "").replace(/^refs\/heads\//, "");
      out.push_data = {
        commit_title:
          last?.message?.split("\n")[0] ||
          (branch ? `push to ${branch}` : "push"),
        commit_from: commits[0]?.sha || ev.payload?.before || "",
        commit_to: last?.sha || ev.payload?.head || "",
        commit_count: commits.length,
        ref: ev.payload?.ref || "",
      };
    }

    // Merged PRs show up as "activity" rows in the commits tile. The public
    // events feed strips `pull_request.title`, so we fall back to the source
    // branch name — which for our convention (ESD-110-audit-logging etc.)
    // still carries the Jira key. head.sha doubles as the pseudo-commit sha.
    if (isMergedPr) {
      const pr = ev.payload?.pull_request || {};
      const branch = pr.head?.ref || "";
      out.push_data = {
        commit_title:
          pr.title ||
          (branch ? `merged #${pr.number}: ${branch}` : `merged PR #${pr.number}`),
        commit_from: pr.base?.sha || "",
        commit_to: pr.merge_commit_sha || pr.head?.sha || "",
        commit_count: pr.commits || 1,
        ref: `refs/heads/${pr.base?.ref || "main"}`,
      };
    }

    return out;
  });
}
