/**
 * review_packets collection — Mongo $jsonSchema validator.
 *
 * Immutable frozen evidence documents (see ReviewPacket in db/types.ts).
 * Append-only: a new submit inserts a new version; nothing updates rows
 * after insert, which is the point — the packet is the record of what
 * was reviewed.
 */

import type { Document } from "mongodb";

export const reviewPacketsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "managerId",
      "submittedAt",
      "level",
      "rangeLabel",
      "narrative",
      "markdown",
      "goals",
      "goalCount",
      "starredCount",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      managerId: { bsonType: ["objectId", "null"] },
      submittedAt: { bsonType: "date" },
      level: { bsonType: "string", maxLength: 100 },
      rangeLabel: { bsonType: "string", maxLength: 200 },
      narrative: { bsonType: "string", maxLength: 20_000 },
      markdown: { bsonType: "string", maxLength: 400_000 },
      goals: {
        bsonType: "array",
        maxItems: 500,
        items: {
          bsonType: "object",
          required: ["goalId", "title"],
          additionalProperties: false,
          properties: {
            goalId: { bsonType: "string", maxLength: 200 },
            title: { bsonType: "string", maxLength: 1_000 },
            l1Title: { bsonType: "string", maxLength: 1_000 },
            tier: { bsonType: ["string", "null"], maxLength: 50 },
            reading: { bsonType: ["string", "null"], maxLength: 500 },
            statusLabel: { bsonType: ["string", "null"], maxLength: 100 },
          },
        },
      },
      goalCount: { bsonType: "int", minimum: 0 },
      starredCount: { bsonType: "int", minimum: 0 },
    },
  },
};
