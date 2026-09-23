import { extractJiraKeys } from "@/lib/regex";

/**
 * Ticket-type share — merged PRs whose linked Jira ticket is of a given type.
 *
 * The ticket route to "how much of my work was bug fixing". Where LABEL_SHARE
 * trusts a label someone put on the PR, this trusts the Jira key the PR
 * already references (title / description / source branch — the same
 * places `linkagePct` looks) and asks Jira what kind of issue it is. Teams
 * that never label PRs almost always link tickets, so this is the metric
 * that works by default.
 *
 * ── What it measures, and what it does not ─────────────────────────────
 * A merged PR counts when ANY key it references resolves to a watched type.
 * A PR with no key, or whose key Jira didn't return (another project, no
 * permission, past the hydration cap), is `unresolved` — reported
 * separately, never folded into "not a bug". The denominator is every
 * merged PR in the window, so an unlinked PR still lowers the share: the
 * goal is about the work, and unlinked work is work.
 *
 * `mr.jira_issue_types` — `{ KEY: "bug" }` — is attached by
 * `useJiraIssueTypes`; rows without it are unresolved.
 */

export const DEFAULT_TICKET_TYPES = Object.freeze(["bug"]);

/** Keys a normalised MR references, from the fields linkage already reads. */
export function mrJiraKeys(mr) {
  const seen = [];
  for (const text of [mr?.title, mr?.description, mr?.source_branch]) {
    for (const key of extractJiraKeys(text)) {
      if (!seen.includes(key)) seen.push(key);
    }
  }
  return seen;
}

/**
 * `filter.ticketType` → lower-cased list. Accepts "Bug", "Bug, Defect" or
 * an array; empty → the Bug default.
 */
export function parseTicketTypes(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out = [];
  for (const item of list) {
    const name = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (name && !out.includes(name)) out.push(name);
  }
  return out.length > 0 ? out : [...DEFAULT_TICKET_TYPES];
}

/**
 * `{ pct, matched, unmatched, unresolved, total, seenTypes }` over merged
 * MRs, or null when the window holds none. `seenTypes` lists the watched
 * types that actually appeared, so the widget can say WHICH rather than
 * asserting a bare percentage.
 */
export function ticketTypeSharePct(mrs = [], types) {
  const merged = (Array.isArray(mrs) ? mrs : []).filter((m) => m?.merged_at);
  if (merged.length === 0) return null;
  const want = new Set(parseTicketTypes(types));
  const seenTypes = new Set();
  let matched = 0;
  let unresolved = 0;
  for (const mr of merged) {
    const keys = mrJiraKeys(mr);
    const typesByKey = mr.jira_issue_types || {};
    const resolved = keys.map((k) => typesByKey[k]).filter((t) => typeof t === "string");
    if (resolved.length === 0) {
      unresolved += 1;
      continue;
    }
    let hit = false;
    for (const t of resolved) {
      if (want.has(t)) {
        seenTypes.add(t);
        hit = true;
      }
    }
    if (hit) matched += 1;
  }
  return {
    pct: Math.round((matched / merged.length) * 100),
    matched,
    unmatched: merged.length - matched - unresolved,
    unresolved,
    total: merged.length,
    seenTypes: [...seenTypes].sort(),
  };
}
