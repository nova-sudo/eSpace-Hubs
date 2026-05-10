/**
 * grading_verdicts collection — Mongo $jsonSchema validator.
 *
 * This is a CACHE. The 180-day TTL on `gradedAt` (declared in
 * collections.ts ensureIndexes) auto-evicts stale entries. Verdicts
 * we'd want long-term should be promoted to a separate "evidence"
 * record before TTL bites — that's evidence-store work for a later
 * milestone.
 */

import type { Document } from "mongodb";

export const gradingVerdictsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "prId",
      "rubricHash",
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
      prId: { bsonType: "string", minLength: 1, maxLength: 200 },
      // SHA-ish hash from the frontend's rubricHash() — a hex digest.
      // Loose bound; we don't want to break a valid hash that happens
      // to be slightly different in a future codepath.
      rubricHash: {
        bsonType: "string",
        minLength: 4,
        maxLength: 128,
        pattern: "^[A-Za-z0-9_-]+$",
      },
      verdict: {
        bsonType: "object",
        required: ["pass", "reasoning", "violations"],
        properties: {
          pass: { bsonType: "bool" },
          reasoning: { bsonType: "string", maxLength: 4_000 },
          violations: {
            bsonType: "array",
            maxItems: 50,
            items: { bsonType: "string", maxLength: 500 },
          },
        },
      },
      gradedAt: { bsonType: "date" },
      model: { bsonType: ["string", "null"], maxLength: 200 },
      provider: { bsonType: ["string", "null"], maxLength: 64 },
    },
  },
};
