/**
 * goal_specs collection — Mongo $jsonSchema validator.
 *
 * The `spec` blob is intentionally loosely typed at this layer. The
 * classifier has its own validator (apps/api/src/modules/ai/
 * classifier/spec-validator.ts) that shapes the spec; the route
 * controller runs that before insert. Mongo just enforces shell
 * containment.
 */

import type { Document } from "mongodb";

export const goalSpecsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "goalId",
      "spec",
      "generatedAt",
      "classifierVersion",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      goalId: { bsonType: "string", minLength: 1, maxLength: 200 },
      spec: { bsonType: "object" },
      generatedAt: { bsonType: "date" },
      classifierVersion: { bsonType: ["string", "null"], maxLength: 200 },
    },
  },
};
