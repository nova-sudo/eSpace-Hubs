import { DAY_MS } from "@/lib/date";

/**
 * Derive "needs your attention" items from open MRs + Jira tickets.
 *
 * - **Stale PR**: open MR where the last update was > 3 days ago.
 * - **Old ticket**: In-Progress/Blocked Jira ticket with no status change in > 7 days.
 *
 * Returns an array of compact `{ id, kind, severity, ref, title, detail, href }`
 * records, capped at `limit`.
 */
export function deriveAttention({ openMRs = [], tickets = [], jiraBaseUrl, limit = 3 } = {}) {
  const now = Date.now();
  const items = [];

  for (const mr of openMRs) {
    const updated = new Date(mr.updated_at).getTime();
    const ageDays = (now - updated) / DAY_MS;
    if (ageDays >= 3) {
      items.push({
        id: `mr-${mr.id}`,
        kind: "stale-pr",
        severity: ageDays >= 6 ? "high" : "med",
        ref: `!${mr.iid}`,
        title: mr.title,
        detail: `${Math.round(ageDays)}d since last update${mr.user_notes_count ? ` · ${mr.user_notes_count} comments` : ""}`,
        action: "Respond",
        href: mr.web_url,
      });
    }
  }

  for (const issue of tickets) {
    const cat = issue.fields?.status?.statusCategory?.key;
    if (cat === "done" || cat === "new") continue; // only track active work
    const updated = new Date(issue.fields?.updated || 0).getTime();
    const ageDays = (now - updated) / DAY_MS;
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
      });
    }
  }

  // High severity first, then most recent
  items.sort((a, b) => {
    const rank = { high: 0, med: 1, low: 2 };
    return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
  });

  return items.slice(0, limit);
}
