/**
 * manager_goal_verdicts collection — Mongo $jsonSchema validator.
 *
 * A manager's durable, authoritative achievement-tier grade for one of
 * their report's goals. One row per (orgId, subjectUserId, goalId),
 * upserted on re-grade. Unlike goal_tier_verdicts this is a RECORD, not a
 * cache — no TTL. It outranks the AI verdict wherever a tier is shown.
 */

import type { Document } from "mongodb";

export const managerGoalVerdictsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "subjectUserId",
      "goalId",
      "tier",
      "note",
      "gradedBy",
      "gradedByName",
      "gradedAt",
      "updatedAt",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      subjectUserId: { bsonType: "objectId" },
      goalId: { bsonType: "string", minLength: 1, maxLength: 200 },
      tier: {
        enum: ["not_achieved", "achieved", "over_achieved", "role_model"],
      },
      note: { bsonType: "string", maxLength: 4_000 },
      gradedBy: { bsonType: "objectId" },
      gradedByName: { bsonType: "string", maxLength: 200 },
      gradedAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
};
