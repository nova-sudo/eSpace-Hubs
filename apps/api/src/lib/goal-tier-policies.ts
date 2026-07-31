/**
 * Manager tier-policy data access — the durable, org-wide achievement-tier
 * CRITERIA a manager sets for a Goal Code. Outranks a matching goal's own
 * `spec.tiers` wherever tiers are shown, independently for the final
 * (whole-goal) and cadence (per-window) ladders.
 *
 * Shared by the manager module (write + list) and the dev-facing
 * `/tier-policies/mine` read, so the "manager policy wins" precedence has a
 * single source of truth.
 */

import type { ObjectId } from "mongodb";
import { getGoalTierPoliciesCollection } from "../db/collections.js";
import type { GoalTierPolicy, TierCriteria } from "../db/types.js";

export interface UpsertTierPolicyInput {
  orgId: ObjectId;
  code: string;
  finalTiers?: TierCriteria | null;
  cadenceTiers?: TierCriteria | null;
  setBy: ObjectId;
}

/**
 * Insert-or-update the policy for (org, code). Only the fields present in
 * the input are touched — passing `finalTiers` without `cadenceTiers`
 * leaves any existing cadence policy on that code untouched (a manager can
 * set the two independently, in separate calls).
 */
export async function upsertTierPolicy(
  input: UpsertTierPolicyInput,
): Promise<GoalTierPolicy> {
  const col = await getGoalTierPoliciesCollection();
  const now = new Date();
  const set: Record<string, unknown> = { setBy: input.setBy, updatedAt: now };
  if (input.finalTiers !== undefined) set.finalTiers = input.finalTiers;
  if (input.cadenceTiers !== undefined) set.cadenceTiers = input.cadenceTiers;

  const updated = await col.findOneAndUpdate(
    { orgId: input.orgId, code: input.code },
    {
      $set: set,
      $setOnInsert: {
        orgId: input.orgId,
        code: input.code,
        createdAt: now,
        ...(input.finalTiers === undefined ? { finalTiers: null } : {}),
        ...(input.cadenceTiers === undefined ? { cadenceTiers: null } : {}),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!updated) {
    throw new Error("goal_tier_policies upsert returned no document");
  }
  return updated;
}

/** Every policy in the org (for the manager authoring screen). */
export async function listTierPolicies(
  orgId: ObjectId,
): Promise<GoalTierPolicy[]> {
  const col = await getGoalTierPoliciesCollection();
  return col.find({ orgId }).sort({ code: 1 }).toArray();
}

/** Policies for a specific set of codes, keyed by code (dev-side resolution). */
export async function getTierPoliciesForCodes(
  orgId: ObjectId,
  codes: string[],
): Promise<Map<string, GoalTierPolicy>> {
  if (codes.length === 0) return new Map();
  const col = await getGoalTierPoliciesCollection();
  const rows = await col.find({ orgId, code: { $in: codes } }).toArray();
  return new Map(rows.map((r) => [r.code, r]));
}

export async function deleteTierPolicy(
  orgId: ObjectId,
  code: string,
): Promise<boolean> {
  const col = await getGoalTierPoliciesCollection();
  const res = await col.deleteOne({ orgId, code });
  return res.deletedCount > 0;
}
