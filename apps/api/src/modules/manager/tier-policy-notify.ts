/**
 * Pure helpers for the F6 `tier_policy_updated` fan-out — which goal in a
 * recipient's tree a Goal Code governs, and the notification payload that
 * deep-links to it.
 *
 * A policy is keyed by Goal Code (`l1.code` / `l2.code`). An L2-code policy
 * governs that L2; an L1-code policy governs the L2s under that L1 (an L2's
 * own code wins per field — see lib/goal-tier-policies). The Goals page
 * deep-links L2 rows (`/goals?goal=<l2 id>`), so an L1 match resolves to its
 * first L2.
 */

interface CodedL2 {
  id: string;
  code?: string | null;
  title?: string | null;
}
interface CodedL1 {
  id: string;
  code?: string | null;
  title?: string | null;
  l2s?: CodedL2[] | null;
}

export interface GovernedGoal {
  goalId: string;
  goalTitle: string | null;
}

const same = (a: string | null | undefined, code: string) => (a || "").trim() === code;

/**
 * The goal in `l1s` that `code` governs, or null when the tree doesn't carry
 * it. A direct L2 match beats an L1 match anywhere in the tree (it's the more
 * specific governance). An L1 match with no L2s resolves to the L1 itself.
 */
export function findGovernedGoal(
  l1s: CodedL1[] | null | undefined,
  code: string,
): GovernedGoal | null {
  const wanted = code.trim();
  if (!wanted) return null;
  const tree = l1s || [];
  for (const l1 of tree) {
    for (const l2 of l1.l2s || []) {
      if (same(l2.code, wanted)) return { goalId: l2.id, goalTitle: l2.title || null };
    }
  }
  for (const l1 of tree) {
    if (!same(l1.code, wanted)) continue;
    const first = (l1.l2s || [])[0];
    return first
      ? { goalId: first.id, goalTitle: first.title || null }
      : { goalId: l1.id, goalTitle: l1.title || null };
  }
  return null;
}

export type TierPolicyChange = "set" | "deleted";

/** The `data` payload of one recipient's `tier_policy_updated` row. */
export function tierPolicyNotificationData(args: {
  code: string;
  cycleKey: string | null;
  change: TierPolicyChange;
  goal: GovernedGoal | null;
}): Record<string, unknown> {
  return {
    // `code` kept for rows/readers that predate `goalCode`.
    code: args.code,
    goalCode: args.code,
    cycleKey: args.cycleKey,
    change: args.change,
    ...(args.goal
      ? {
          goalId: args.goal.goalId,
          ...(args.goal.goalTitle ? { goalTitle: args.goal.goalTitle } : {}),
        }
      : {}),
  };
}
