/**
 * goal_context collection — Mongo $jsonSchema validator.
 *
 * `answers` is opaque at this layer (the frontend stores keys as
 * questionIds pointing at strings, lists, numbers, booleans). The
 * route controller validates incoming answers against the spec's
 * declared question kinds.
 */

import type { Document } from "mongodb";

export const goalContextValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["orgId", "userId", "goalId", "answers", "updatedAt"],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      goalId: { bsonType: "string", minLength: 1, maxLength: 200 },
      answers: { bsonType: "object" },
      updatedAt: { bsonType: "date" },
    },
  },
};
