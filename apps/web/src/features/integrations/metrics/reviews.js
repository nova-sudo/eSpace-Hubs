/**
 * Number of comments the user left on MergeRequest targets in the given period.
 *
 * NOTE: GitLab's `/events` feed doesn't give us the MR author, so this includes
 * comments on the user's own MRs. Good enough as a "engagement" signal. Real
 * "reviews given to teammates" needs the MR author check, which requires
 * resolving each `target_id`.
 */
export function countMrComments(events = []) {
  return events.filter(
    (e) =>
      (e.action_name === "commented on" || e.action_name === "commented") &&
      e.target_type === "MergeRequest",
  ).length;
}
