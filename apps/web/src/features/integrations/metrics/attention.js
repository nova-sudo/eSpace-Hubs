import { DAY_MS } from "@/lib/date";

/**
 * Derive "needs your attention" items from open PRs/MRs + Jira tickets.
 *
 * - **Stale PR/MR**: open item whose last update was > 3 days ago.
 * - **Old ticket**: In-Progress/Blocked Jira ticket with no status change in > 7 days.
 *
 * Provider-agnostic: each open item may be a GitLab MR or a GitHub PR.
 * The two carry different field names (`web_url`/`html_url`,
 * `iid`/`number`, `user_notes_count`/`comments`), so we read both with a
 * fallback; `item.source` ("gitlab"|"github") picks the `!`/`#` ref
 * notation (attention-band tags each item with its source).
 *
 * Returns an array of compact `{ id, kind, severity, ref, title, detail, href }`
 * records, capped at `limit`.
 */
export function deriveAttention({ openMRs = [], tickets = [], jiraBaseUrl, limit = 3 } = {}) {
  const now = Date.now();
  const items = [];

  for (const mr of openMRs) {
    const updatedAt = mr.updated_at ?? mr.updatedAt;
    const updated = updatedAt ? new Date(updatedAt).getTime() : NaN;
    const ageDays = (now - updated) / DAY_MS;
    if (!Number.isFinite(ageDays)) continue; // no/invalid timestamp → skip
    if (ageDays >= 3) {
      const number = mr.iid ?? mr.number;
      const comments = mr.user_notes_count ?? mr.comments ?? 0;
      const url = mr.web_url ?? mr.html_url;
      const refPrefix = mr.source === "github" ? "#" : "!";
      items.push({
        // Source-prefixed so a GitLab MR id and a GitHub PR id can't
        // collide on the React key.
        id: `${mr.source || "mr"}-${mr.id}`,
        kind: "stale-pr",
        severity: ageDays >= 6 ? "high" : "med",
        ref: `${refPrefix}${number}`,
        title: mr.title,
        detail: `${Math.round(ageDays)}d since last update${comments ? ` · ${comments} comments` : ""}`,
        action: "Respond",
        href: url,
        _ageDays: ageDays,
      });
    }
  }

  for (const issue of tickets) {
    const cat = issue.fields?.status?.statusCategory?.key;
    if (cat === "done" || cat === "new") continue; // only track active work
    // Same guard the MR branch has: a missing `updated` used to fall
    // back to epoch 0 → a permanent bogus "20700d since last change"
    // high-severity alert.
    const updatedAt = issue.fields?.updated;
    const updated = updatedAt ? new Date(updatedAt).getTime() : NaN;
    const ageDays = (now - updated) / DAY_MS;
    if (!Number.isFinite(ageDays)) continue;
    if (ageDays >= 7) {
      items.push({
        id: `issue-${issue.id}`,
        kind: "old-ticket",
        severity: ageDays >= 10 ? "high" : "med",
        ref: issue.key,
        title: issue.fields?.summary,
        detail: `${Math.round(ageDays)}d since last change`,
        action: "Unblock",
        href: jiraBaseUrl ? `${jiraBaseUrl}/browse/${issue.key}` : undefined,
        _ageDays: ageDays,
      });
    }
  }

  // High severity first, then most-recently-touched within a severity —
  // the old comparator ranked severity ONLY, so ordering fell back to
  // insertion order (all MRs, then all tickets) and three stale PRs
  // permanently starved every ticket alert out of the `limit` cap.
  items.sort((a, b) => {
    const rank = { high: 0, med: 1, low: 2 };
    const bySeverity = (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
    if (bySeverity !== 0) return bySeverity;
    return (a._ageDays ?? 0) - (b._ageDays ?? 0);
  });

  return items.slice(0, limit).map(({ _ageDays, ...item }) => item);
}
