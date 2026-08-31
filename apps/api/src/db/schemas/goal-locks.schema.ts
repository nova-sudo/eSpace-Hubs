/**
 * goal_locks collection — Mongo $jsonSchema validator.
 *
 * One document per (orgId, userId): the user's settle-locks as a flat
 * array of `"<goalId>::<windowKey>"` keys. Server-persisted (BL-011's
 * last holdout) because the cadence-consistency CAP on displayed tiers
 * reads these — while they were device-local localStorage, the same
 * goal showed different achievement tiers per device and a re-login
 * silently degraded the user's own badge.
 */

import type { Document } from "mongodb";

export const goalLocksValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["orgId", "userId", "keys", "updatedAt"],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      keys: {
        bsonType: "array",
        maxItems: 20_000,
        items: { bsonType: "string", minLength: 1, maxLength: 400 },
      },
      updatedAt: { bsonType: "date" },
    },
  },
};
