/**
 * scheduler_stamps collection — Mongo $jsonSchema validator.
 *
 * Dedupe ledger for the F4 scheduler (src/scheduler/jobs.ts): one row
 * per already-fired event, claimed via a unique-index insert on `key`
 * before the job acts. TTL on `at` (declared in collections.ts) keeps
 * it bounded.
 */

import type { Document } from "mongodb";

export const schedulerStampsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["key", "at"],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      key: { bsonType: "string", minLength: 1, maxLength: 300 },
      at: { bsonType: "date" },
    },
  },
};
