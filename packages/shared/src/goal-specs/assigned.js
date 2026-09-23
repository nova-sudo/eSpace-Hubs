/**
 * Assigned ("shared") goals — a goal a manager authors once and hands to
 * several people. Each assignee sees it inside their own goal tree under a
 * synthetic, read-only id; these helpers are the one definition of that id
 * scheme so web and api can't disagree about what "assigned" looks like.
 *
 *   asg_<24-hex ObjectId>   one assigned goal (an L2 in the assignee's tree)
 *   asg__root               the synthetic L1 that groups them ("Shared goals")
 */

export const ASSIGNED_GOAL_PREFIX = "asg_";
export const ASSIGNED_ROOT_ID = "asg__root";

const HEX_24 = /^[0-9a-f]{24}$/i;

/** True for any synthetic assigned-goal id — the L2s AND the grouping L1. */
export function isAssignedGoalId(id) {
  return typeof id === "string" && id.startsWith(ASSIGNED_GOAL_PREFIX);
}

/** `asg_<hex>` for an assigned_goals document id (string or ObjectId). */
export function assignedGoalId(hex) {
  return `${ASSIGNED_GOAL_PREFIX}${String(hex)}`;
}

/** The assigned_goals document id behind `asg_<hex>`, or null. */
export function parseAssignedGoalId(id) {
  if (!isAssignedGoalId(id) || id === ASSIGNED_ROOT_ID) return null;
  const hex = id.slice(ASSIGNED_GOAL_PREFIX.length);
  return HEX_24.test(hex) ? hex : null;
}
