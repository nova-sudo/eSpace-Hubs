/**
 * Repo-slug extraction + filtering for normalised merge-request rows.
 *
 * GitHub and GitLab both expose a `web_url` like
 *   https://github.com/owner/name/pull/123
 *   https://gitlab.com/group/project/-/merge_requests/123
 *
 * From either, the segment between the host and the PR-path is the
 * repo slug we care about ("owner/name" or "group/project"). Doing the
 * parse here keeps the normalisers (`github-normalize.js`,
 * `gitlab.js`) untouched and lets `useDataSource` filter both
 * providers uniformly.
 *
 * No regex anchoring on the host so this works for github.com, GHE,
 * self-hosted GitLab, etc.
 */

const GITHUB_PR_RE = /^https?:\/\/[^/]+\/(.+?)\/pull\//i;
const GITLAB_MR_RE = /^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\//i;

/**
 * Return the `owner/name` (or `group/project`) for a normalised MR,
 * or null when we can't tell. Always returns lower-case so a
 * case-insensitive filter equals comparison works on either side.
 */
export function mrRepo(mr) {
  if (!mr) return null;
  const url = mr.web_url || mr.repository_url || "";
  if (!url) return null;
  const m = url.match(GITHUB_PR_RE) || url.match(GITLAB_MR_RE);
  if (!m) return null;
  return m[1].toLowerCase();
}

/**
 * Filter an array of MRs to only those whose repo matches the target.
 * Comparison is case-insensitive. A null / empty / undefined target
 * is a no-op (returns the input unchanged) so call sites don't have
 * to gate on the presence of the filter.
 */
export function filterMrsByRepo(mrs, repo) {
  if (!Array.isArray(mrs)) return [];
  if (!repo || typeof repo !== "string") return mrs;
  const target = repo.trim().toLowerCase();
  if (!target) return mrs;
  return mrs.filter((m) => mrRepo(m) === target);
}

/**
 * Build a unique, sorted list of repo slugs from a list of MRs. Used
 * by the Review pane's repo picker — derives the dropdown options
 * straight from the data the user has access to, so we don't need a
 * separate "list all my repos" API call.
 */
export function listReposFromMrs(mrs) {
  const set = new Set();
  for (const m of mrs || []) {
    const r = mrRepo(m);
    if (r) set.add(r);
  }
  return [...set].sort();
}
