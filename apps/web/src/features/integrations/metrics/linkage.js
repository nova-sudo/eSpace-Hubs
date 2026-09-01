import { hasJiraKey } from "@/lib/regex";

/**
 * % of merged MRs whose title / description / source branch references a
 * Jira key. Uses hasJiraKey (shape match minus famous tech tokens) —
 * the raw regex counted "supports UTF-8" and "bump to SHA-256" as
 * Jira-linked, inflating the metric (audit #237).
 * Returns null if there are no merged MRs yet.
 */
export function linkagePct(mrs = []) {
  const merged = mrs.filter((m) => m.merged_at);
  if (merged.length === 0) return null;
  const linked = merged.filter(
    (m) =>
      hasJiraKey(m.title || "") ||
      hasJiraKey(m.description || "") ||
      hasJiraKey(m.source_branch || ""),
  ).length;
  return {
    pct: Math.round((linked / merged.length) * 100),
    linked,
    loose: merged.length - linked,
  };
}
