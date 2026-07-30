/**
 * goal_tier_verdicts collection — Mongo $jsonSchema validator.
 *
 * A durable CACHE of the AI achievement-tier verdict per goal, keyed by a
 * `tierHash` (the frontend's hash of tiers + graded prose + reading). One row
 * per (orgId, userId, goalId): a data change bumps the hash and the controller
 * upserts the new verdict, replacing the old. A 180-day TTL on `gradedAt`
 * evicts verdicts for goals the user has abandoned.
 *
 * This replaces the per-device localStorage-only cache: grade once, persist,
 * and share the verdict across the user's devices/sessions, re-grading only
 * when the goal's data actually changes.
 */

import type { Document } from "mongodb";

export const goalTierVerdictsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "goalId",
      "tierHash",
      "verdict",
      "gradedAt",
      "model",
      "provider",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      goalId: { bsonType: "string", minLength: 1, maxLength: 200 },
      // Frontend hashStr() digest — base36, but keep the bound loose so a
      // future hash scheme doesn't trip the validator.
      tierHash: {
        bsonType: "string",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9_-]+$",
      },
      verdict: {
        bsonType: "object",
        required: ["tier", "reasoning", "confidence"],
        additionalProperties: false,
        properties: {
          tier: {
            enum: ["not_achieved", "achieved", "over_achieved", "role_model"],
          },
          reasoning: { bsonType: "string", maxLength: 4_000 },
          confidence: { enum: ["high", "medium", "low"] },
        },
      },
      gradedAt: { bsonType: "date" },
      model: { bsonType: ["string", "null"], maxLength: 200 },
      provider: { bsonType: ["string", "null"], maxLength: 64 },
    },
  },
};
