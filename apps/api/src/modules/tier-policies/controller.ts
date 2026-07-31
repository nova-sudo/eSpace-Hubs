/**
 * Tier-policies controller — the CURRENT user's own goals, resolved
 * against any manager tier policy that governs them.
 *
 *   GET /api/v1/tier-policies/mine   manager-set tier criteria, keyed by
 *                                    the caller's own L2 goalIds
 *
 * A manager tier policy is authored by Goal Code (l1.code, org-wide), not
 * by goalId — so it can't be looked up the same direct way manager
 * verdicts are. Instead the JOIN happens here, server-side, where both the
 * caller's goal tree and the policy collection are reachable: walk the
 * tree, resolve each L1's code against a policy, and hand back the result
 * keyed by every L2 goalId under that L1 (v1 scope is L1-level governance
 * only — every L2 under a governed L1 inherits the same policy). This
 * keeps the CLIENT ignorant of Goal Codes entirely — `useGoalTier` and
 * `useGoalWindowTier` only ever need `readTierPolicy(goalId)`, exactly
 * like the existing manager-verdict lookup.
 */

import type { NextFunction, Request, Response } from "express";
import { getGoalsCollection } from "../../db/collections.js";
import { getTierPoliciesForCodes } from "../../lib/goal-tier-policies.js";
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
    const codes = [
      ...new Set(l1s.map((l1) => (l1.code || "").trim()).filter(Boolean)),
    ];
    const policyByCode = await getTierPoliciesForCodes(session.orgId, codes);

    const byGoalId: Record<
      string,
      { code: string; finalTiers: unknown; cadenceTiers: unknown }
    > = {};
    for (const l1 of l1s) {
      const code = (l1.code || "").trim();
      if (!code) continue;
      const policy = policyByCode.get(code);
      if (!policy) continue;
      if (policy.finalTiers === null && policy.cadenceTiers === null) continue;
      for (const l2 of l1.l2s ?? []) {
        byGoalId[l2.id] = {
          code,
          finalTiers: policy.finalTiers,
          cadenceTiers: policy.cadenceTiers,
        };
      }
    }

    res.json({ policies: byGoalId });
  } catch (err) {
    next(err);
  }
}
