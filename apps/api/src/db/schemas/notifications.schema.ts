/**
 * notifications collection — Mongo $jsonSchema validator.
 *
 * In-app inbox rows, one per recipient (`userId`). Written by privileged
 * actions (manager grading, BYO approval) and read via
 * GET /api/v1/notifications. A 180-day TTL on `createdAt` (declared in
 * collections.ts) keeps the feed bounded.
 */

import type { Document } from "mongodb";

export const notificationsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "kind",
      "title",
      "body",
      "createdAt",
      "createdBy",
      "readAt",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      kind: {
        enum: [
          "manager_graded",
          "goal_submitted",
          "goal_approved",
          "goal_changes_requested",
        ],
      },
      title: { bsonType: "string", minLength: 1, maxLength: 200 },
      body: { bsonType: "string", maxLength: 2_000 },
      // Display-only payload (goalId, tier, actor name). Permissive object;
      // the controller shapes it. Optional — absent is treated as null.
      data: { bsonType: ["object", "null"] },
      createdAt: { bsonType: "date" },
      createdBy: { bsonType: ["objectId", "null"] },
      readAt: { bsonType: ["date", "null"] },
    },
  },
};
