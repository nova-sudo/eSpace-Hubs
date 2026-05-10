import { JIRA_KEY_RE } from "@/lib/regex";

/**
 * % of merged MRs whose title / description / source branch references a Jira key.
 * Returns null if there are no merged MRs yet.
 */
export function linkagePct(mrs = []) {
  const merged = mrs.filter((m) => m.merged_at);
  if (merged.length === 0) return null;
  const linked = merged.filter(
    (m) =>
      JIRA_KEY_RE.test(m.title || "") ||
      JIRA_KEY_RE.test(m.description || "") ||
      JIRA_KEY_RE.test(m.source_branch || ""),
  ).length;
  return {
    pct: Math.round((linked / merged.length) * 100),
    linked,
    loose: merged.length - linked,
  };
}
