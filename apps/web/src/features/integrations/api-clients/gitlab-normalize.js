/**
 * GitLab → common-shape adapters.
 *
 * Counterpart to `github-normalize.js`. The provider-agnostic layers
 * (review-timing, CODE_RUBRIC grading, the merged-MR metrics) were all
 * written against one shape; these adapters map GitLab's MR + notes
 * payloads onto it so a GitLab-only user gets the same features a
 * GitHub user does — review timing, rubric grading, etc.
 *
 * Two shapes produced here:
 *
 *   MR DETAILS (matches `githubApi.pullDetails`):
 *     { title, body, state, author, createdAt, mergedAt, htmlUrl,
 *       baseRef, headRef,
 *       comments: [{ id, user, body, kind:"issue"|"review", createdAt,
 *                    path?, line?, htmlUrl? }] }
 *
 *   MERGED MR (matches `normalizeGithubMergedSearch` output):
 *     the native GitLab MR plus `source:"gitlab"` and a `number` alias —
 *     so the combined merged list can route each item to its provider's
 *     details fetch via `parseGitlabLocator`.
 */

/**
 * Map one GitLab MR note → the common comment shape.
 *
 * GitLab note kinds:
 *   - `system: true`           auto-generated ("approved", "added 1 commit",
 *                              "changed the description"). EXCLUDED — these
 *                              aren't human review comments, and counting
 *                              them would inflate review-timing/round metrics
 *                              (GitHub's pullDetails likewise omits bare
 *                              approvals / system activity).
 *   - `type: "DiffNote"`       inline code-review comment → kind "review"
 *   - `type: "DiscussionNote"` / null   conversation comment → kind "issue"
 */
function noteToComment(n) {
  const pos = n?.position || null;
  return {
    id: n?.id,
    user: n?.author?.username || "unknown",
    body: typeof n?.body === "string" ? n.body : "",
    kind: n?.type === "DiffNote" ? "review" : "issue",
    createdAt: n?.created_at || null,
    path: pos?.new_path || pos?.old_path || null,
    line: pos?.new_line ?? pos?.old_line ?? null,
    htmlUrl: null, // GitLab notes carry no direct permalink in this payload
  };
}

/**
 * Normalize a GitLab MR + its notes into the common PR-details shape
 * (the same contract `githubApi.pullDetails` returns), so review-timing
 * and the AI grader consume both providers identically.
 */
export function normalizeGitlabMrDetails(mr, notes) {
  const human = (Array.isArray(notes) ? notes : []).filter(
    (n) => n && !n.system,
  );
  return {
    title: mr?.title || "",
    body: typeof mr?.description === "string" ? mr.description : "",
    state: mr?.merged_at
      ? "merged"
      : mr?.state === "opened"
        ? "open"
        : mr?.state || "open",
    author: mr?.author?.username || null,
    createdAt: mr?.created_at || null,
    mergedAt: mr?.merged_at || null,
    htmlUrl: mr?.web_url || null,
    baseRef: mr?.target_branch || null,
    headRef: mr?.source_branch || null,
    comments: human.map(noteToComment),
  };
}

/**
 * Tag a GitLab merged-MR list with `source:"gitlab"` + a `number` alias
 * (GitHub's records use `number`). All native fields the metrics layer
 * reads — merged_at, created_at, title, description, source_branch,
 * user_notes_count, web_url, project_id, iid — are preserved verbatim.
 *
 * Additive only: pre-existing consumers keep working; the new fields let
 * the combined list route each item back to its provider for a details
 * fetch (see `parseGitlabLocator`).
 */
export function normalizeGitlabMerged(resp) {
  const items = Array.isArray(resp) ? resp : [];
  return items
    .filter((mr) => mr && mr.merged_at)
    .map((mr) => ({
      ...mr,
      source: "gitlab",
      number: mr.iid,
    }));
}

/**
 * Resolve `{ projectId, iid }` for a details fetch from a normalized
 * GitLab MR record. GitLab list/object payloads carry both natively, so
 * no URL parsing is needed (and the numeric project_id can't be
 * recovered from web_url anyway). Returns null when the record isn't a
 * GitLab MR.
 */
export function parseGitlabLocator(mr) {
  if (mr?.project_id != null && mr?.iid != null) {
    return { projectId: mr.project_id, iid: mr.iid };
  }
  return null;
}
