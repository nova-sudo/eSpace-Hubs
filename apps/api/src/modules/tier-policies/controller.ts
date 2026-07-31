/**
 * Tier-policies controller — the CURRENT user's own goals, resolved
 * against any manager tier policy that governs them.
 *
 *   GET /api/v1/tier-policies/mine   manager-set tier criteria, keyed by
 *                                    the caller's own L2 goalIds
 *
 * A manager tier policy is authored by Goal Code (l1.code OR l2.code,
 * org-wide), not by goalId — so it can't be looked up the same direct way
 * manager verdicts are. Instead the JOIN happens here, server-side, where
 * both the caller's goal tree and the policy collection are reachable.
 *
 * Precedence, resolved INDEPENDENTLY per tier type (finalTiers and
 * cadenceTiers never fall back to or influence each other):
 *   1. A policy on this L2's OWN code, if it sets that field.
 *   2. Else a policy on the containing L1's code, if it sets that field.
 *   3. Else unset — the client falls back to the goal's own spec.tiers.
 *
 * This keeps the CLIENT ignorant of Goal Codes entirely — `useGoalTier`
 * and `useGoalWindowTier` only ever need `readTierPolicy(goalId)`, exactly
 * like the existing manager-verdict lookup.
 */

import type { NextFunction, Request, Response } from "express";
import { getGoalsCollection } from "../../db/collections.js";
import { getTierPoliciesForCodes } from "../../lib/goal-tier-policies.js";
import type { GoalTierPolicy, TierCriteria } from "../../db/types.js";
import { HttpError } from "../../middleware/error-handler.js";

export async function listMyTierPoliciesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = req.session;
    if (!session) {
      throw new HttpError(401, "unauthenticated", "Login required.");
    }

    const tree = await getGoalsCollection().then((c) =>
      c.findOne({ orgId: session.orgId, userId: session.userId }),
    );
    const l1s = tree?.l1s ?? [];

    const codes = new Set<string>();
    for (const l1 of l1s) {
      const l1Code = (l1.code || "").trim();
      if (l1Code) codes.add(l1Code);
      for (const l2 of l1.l2s ?? []) {
        const l2Code = (l2.code || "").trim();
        if (l2Code) codes.add(l2Code);
      }
    }
    const policyByCode = await getTierPoliciesForCodes(session.orgId, [
      ...codes,
    ]);

    const byGoalId: Record<
      string,
      { code: string; finalTiers: TierCriteria | null; cadenceTiers: TierCriteria | null }
    > = {};
    for (const l1 of l1s) {
      const l1Code = (l1.code || "").trim();
      const l1Policy: GoalTierPolicy | undefined = l1Code
        ? policyByCode.get(l1Code)
        : undefined;

      for (const l2 of l1.l2s ?? []) {
        const l2Code = (l2.code || "").trim();
        const l2Policy: GoalTierPolicy | undefined = l2Code
          ? policyByCode.get(l2Code)
          : undefined;

        // Per-field precedence: the L2's own policy wins for a field ONLY
        // when it actually sets that field — an L2 policy that sets only
        // cadenceTiers doesn't suppress an L1 policy's finalTiers.
        const finalTiers = l2Policy?.finalTiers ?? l1Policy?.finalTiers ?? null;
        const cadenceTiers =
          l2Policy?.cadenceTiers ?? l1Policy?.cadenceTiers ?? null;
        if (finalTiers === null && cadenceTiers === null) continue;

        const finalFromL2 = l2Policy?.finalTiers != null;
        const cadenceFromL2 = l2Policy?.cadenceTiers != null;
        byGoalId[l2.id] = {
          // Display/debug hint only — whichever code contributed a field
          // that actually governs this goal. Not consumed by the client
          // today (only `finalTiers`/`cadenceTiers` presence matters).
          code: finalFromL2 || cadenceFromL2 ? l2Code : l1Code,
          finalTiers,
          cadenceTiers,
        };
      }
    }

    res.json({ policies: byGoalId });
  } catch (err) {
    next(err);
  }
}
