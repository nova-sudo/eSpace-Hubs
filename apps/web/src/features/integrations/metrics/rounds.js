/**
 * Proxy for "review rounds" — average number of reviewer comments
 * (`user_notes_count`) on the user's merged MRs.
 *
 * A true "rounds" metric requires per-MR /discussions API calls and is left for a
 * later pass — see README "open questions".
 */
export function avgReviewerComments(mrs = []) {
  const merged = mrs.filter((m) => m.merged_at);
  if (merged.length === 0) return null;
  const total = merged.reduce((sum, m) => sum + (m.user_notes_count || 0), 0);
  return total / merged.length;
}
