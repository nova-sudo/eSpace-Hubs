/**
 * goal_tier_policies collection — Mongo $jsonSchema validator.
 *
 * A manager's durable, org-wide achievement-tier CRITERIA policy for a Goal
 * Code (currently the free-text `l1.code` / `l2.code` a developer types into
 * their own goal tree; Zoho will supply these later). One row per
 * (orgId, code) — the same collection holds both L1- and L2-level codes,
 * since a code is just a string here; resolution order (an L2's own code
 * outranks its parent L1's) lives in modules/tier-policies/controller.ts.
 *
 * Unlike `manager_goal_verdicts` (a manager's grade for one specific dev's
 * one specific goal), this sets the CRITERIA TEXT itself — the four-rung
 * ladder — and applies to every developer whose goal shares that code, not
 * one goalId. `finalTiers` (the whole-goal ladder) and `cadenceTiers` (the
 * per-cadence-window ladder) are independent: either may be null, and
 * resolving one never falls back to or is compared against the other.
 */

import type { Document } from "mongodb";

const tierCriteriaSchema: Document = {
  bsonType: "object",
  additionalProperties: false,
  properties: {
    notAchieved: { bsonType: ["string", "null"], maxLength: 600 },
    achieved: { bsonType: ["string", "null"], maxLength: 600 },
    overAchieved: { bsonType: ["string", "null"], maxLength: 600 },
    roleModel: { bsonType: ["string", "null"], maxLength: 600 },
  },
};

export const goalTierPoliciesValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["orgId", "code", "setBy", "createdAt", "updatedAt"],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      // The Goal Code (L1 or L2) — free text, case-sensitive exact match
      // against l1.code / l2.code. Not validated for format here (neither
      // is the dev-side field it matches against).
      code: { bsonType: "string", minLength: 1, maxLength: 200 },
      finalTiers: { bsonType: ["object", "null"], ...tierCriteriaSchema },
      cadenceTiers: { bsonType: ["object", "null"], ...tierCriteriaSchema },
      setBy: { bsonType: "objectId" },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
};
