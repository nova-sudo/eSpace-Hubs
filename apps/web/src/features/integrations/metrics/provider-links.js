/**
 * "Check at the source" links — the page a person can open to see the exact
 * pull requests / tickets a tile counted.
 *
 * Every AUTO number in the app is a claim about data that lives somewhere
 * else. A link to the same query on the provider's own site is the cheapest
 * form of provenance there is: it costs no request, it is scoped exactly the
 * way the metric is (the author, the calendar year, the labels, the repo),
 * and a manager reading a review can check it without asking. Pure
 * functions; the widget layer supplies usernames and hosts.
 */

const GITHUB_WEB = "https://github.com";
const MAX_JIRA_KEYS = 50;

function sinceDay(year) {
  return `${year || new Date().getUTCFullYear()}-01-01`;
}

/** GitHub's OR syntax for labels: label:"a","b". Empty → no clause. */
function labelClause(labels) {
  const list = (Array.isArray(labels) ? labels : []).filter((l) => typeof l === "string" && l);
  if (list.length === 0) return "";
  return ` label:${list.map((l) => `"${l.replace(/"/g, "")}"`).join(",")}`;
}

/**
 * Merged PRs by the user this year, optionally carrying any of `labels`, in
 * one repo (`owner/name`) or across all of them. `author` defaults to `@me`,
 * which GitHub resolves to whoever is signed in — the viewer of their own tile.
 */
export function githubMergedPrsUrl({ repo = null, author = null, labels = [], year } = {}) {
  const q = `is:pr is:merged author:${author || "@me"} merged:>=${sinceDay(year)}${labelClause(labels)}`;
  return repo
    ? `${GITHUB_WEB}/${repo}/pulls?q=${encodeURIComponent(q)}`
    : `${GITHUB_WEB}/search?type=pullrequests&q=${encodeURIComponent(q)}`;
}

/**
 * The GitLab counterpart. Needs the host (self-hosted here) and, to scope by
 * author, the username — GitLab has no "@me" in its list filters. Without a
 * repo it links the user's dashboard list, which GitLab already scopes to
 * "merge requests I authored" when `author_username` is set.
 */
export function gitlabMergedMrsUrl({ baseUrl, repo = null, author = null, labels = [] } = {}) {
  const base = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
  if (!base) return null;
  const qs = new URLSearchParams({ state: "merged" });
  if (author) qs.set("author_username", author);
  for (const l of Array.isArray(labels) ? labels : []) if (typeof l === "string" && l) qs.append("label_name[]", l);
  return repo
    ? `${base}/${repo}/-/merge_requests?${qs.toString()}`
    : `${base}/dashboard/merge_requests?${qs.toString()}`;
}

/**
 * The Jira issues a set of PRs referenced, filtered to the watched types —
 * the ticket route's "check it yourself". Capped so the URL stays sane;
 * newest-first is the caller's job (pass keys in the order they matter).
 */
export function jiraIssuesUrl({ baseUrl, keys = [], types = [] } = {}) {
  const base = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
  const list = (Array.isArray(keys) ? keys : [])
    .filter((k) => typeof k === "string" && /^[A-Z][A-Z0-9]+-\d+$/.test(k))
    .slice(0, MAX_JIRA_KEYS);
  if (!base || list.length === 0) return null;
  const typeList = (Array.isArray(types) ? types : []).filter((t) => typeof t === "string" && t);
  const clauses = [`key in (${list.join(",")})`];
  if (typeList.length > 0) clauses.push(`issuetype in (${typeList.map((t) => `"${t.replace(/"/g, "")}"`).join(",")})`);
  return `${base}/issues/?jql=${encodeURIComponent(clauses.join(" AND "))}`;
}
