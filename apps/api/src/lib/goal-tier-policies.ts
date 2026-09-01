/**
 * Manager tier-policy data access — the durable achievement-tier
 * CRITERIA a manager sets for a Goal Code. Outranks a matching goal's
 * own `spec.tiers` wherever tiers are shown, independently for the
 * final (whole-goal) and cadence (per-window) ladders.
 *
 * F6 keying: one row per (org, code, cycleKey) where cycleKey is the
 * calendar year ("2026"). Legacy rows written before scoping carry no
 * cycleKey and apply to any cycle; at resolution a cycle-scoped row for
 * the same code outranks the legacy row. This kills the cross-year
 * collision (#223) without a data migration — old rows keep governing
 * until a manager re-saves them, which writes the scoped key.
 *
 * Shared by the manager module (write + list) and the dev-facing
 * `/tier-policies/mine` read, so the "manager policy wins" precedence
 * has a single source of truth.
 */

import type { Filter, ObjectId } from "mongodb";
import { getGoalTierPoliciesCollection } from "../db/collections.js";
import type { GoalTierPolicy, TierCriteria } from "../db/types.js";

/** The current performance cycle's key — the UTC calendar year. */
export function currentCycleKey(now = new Date()): string {
  return String(now.getUTCFullYear());
}

/** Filter clause matching one row identity, treating null as "legacy". */
function cycleFilter(cycleKey: string | null): Filter<GoalTierPolicy> {
  return cycleKey === null
    ? { $or: [{ cycleKey: null }, { cycleKey: { $exists: false } }] }
    : { cycleKey };
}

export interface UpsertTierPolicyInput {
  orgId: ObjectId;
  code: string;
  /** "YYYY". Callers default this to currentCycleKey() — new writes are
   *  always scoped; only pre-F6 rows are ever unscoped. */
  cycleKey: string;
  finalTiers?: TierCriteria | null;
  cadenceTiers?: TierCriteria | null;
  setBy: ObjectId;
}

/**
 * Insert-or-update the policy for (org, code, cycle). Only the fields
 * present in the input are touched — passing `finalTiers` without
 * `cadenceTiers` leaves any existing cadence policy on that row
 * untouched (a manager can set the two independently, in separate
 * calls).
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
    { orgId: input.orgId, code: input.code, ...cycleFilter(input.cycleKey) },
    {
      $set: set,
      $setOnInsert: {
        orgId: input.orgId,
        code: input.code,
        cycleKey: input.cycleKey,
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

/**
 * Policies for a specific set of codes, keyed by code, resolved for ONE
 * cycle (default: the current year): a row scoped to that cycle wins;
 * a legacy unscoped row fills in only where no scoped row exists. A row
 * scoped to a DIFFERENT cycle never matches — 2026 criteria don't grade
 * 2027 goals.
 */
export async function getTierPoliciesForCodes(
  orgId: ObjectId,
  codes: string[],
  cycleKey: string = currentCycleKey(),
): Promise<Map<string, GoalTierPolicy>> {
  if (codes.length === 0) return new Map();
  const col = await getGoalTierPoliciesCollection();
  const rows = await col
    .find({
      orgId,
      code: { $in: codes },
      $or: [{ cycleKey }, { cycleKey: null }, { cycleKey: { $exists: false } }],
    })
    .toArray();
  const out = new Map<string, GoalTierPolicy>();
  for (const r of rows) {
    const existing = out.get(r.code);
    if (!existing || (r.cycleKey === cycleKey && existing.cycleKey !== cycleKey)) {
      out.set(r.code, r);
    }
  }
  return out;
}

/**
 * Delete ONE row identity: (code, cycleKey) — cycleKey null targets the
 * legacy unscoped row. The authoring UI passes exactly the identity of
 * the row the manager is looking at, so removing a 2026 policy never
 * silently removes the legacy one (or vice versa).
 */
export async function deleteTierPolicy(
  orgId: ObjectId,
  code: string,
  cycleKey: string | null,
): Promise<boolean> {
  const col = await getGoalTierPoliciesCollection();
  const res = await col.deleteOne({ orgId, code, ...cycleFilter(cycleKey) });
  return res.deletedCount > 0;
}
