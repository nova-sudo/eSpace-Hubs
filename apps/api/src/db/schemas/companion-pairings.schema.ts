/**
 * companion_pairings collection — Mongo $jsonSchema validator.
 *
 * Short-lived rows that hold the state of an in-flight device pairing.
 * The `_id` IS the pairing code the user reads off the companion app
 * and verifies in the browser approval dialog (e.g. "XKCD-1234"). A
 * TTL index on `expiresAt` (see collections.ts) auto-evicts expired
 * pairings, so we don't need a separate sweep job.
 *
 * State machine:
 *   1. Companion creates row with approvedAt/approvedByUserId/
 *      pendingTokenHash/consumedAt all null.
 *   2. User clicks Approve in the browser → approvedAt + approvedByUserId
 *      + pendingTokenHash get set (single atomic update).
 *   3. Companion's next poll sees approvedAt non-null, receives the
 *      plaintext token ONCE, then we set consumedAt so subsequent polls
 *      return "consumed" instead of leaking the token.
 */

import type { Document } from "mongodb";

export const companionPairingsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "_id",
      "deviceName",
      "createdByIp",
      "createdByUa",
      "createdAt",
      "expiresAt",
      "approvedAt",
      "approvedByUserId",
      "pendingTokenHash",
      "consumedAt",
    ],
    additionalProperties: true,
    properties: {
      _id: { bsonType: "string", minLength: 4, maxLength: 64 },
      deviceName: { bsonType: "string", minLength: 1, maxLength: 200 },
      createdByIp: { bsonType: ["string", "null"], maxLength: 64 },
      createdByUa: { bsonType: ["string", "null"], maxLength: 512 },
      createdAt: { bsonType: "date" },
      expiresAt: { bsonType: "date" },
      approvedAt: { bsonType: ["date", "null"] },
      approvedByUserId: { bsonType: ["objectId", "null"] },
      pendingTokenHash: { bsonType: ["string", "null"], minLength: 32, maxLength: 128 },
      consumedAt: { bsonType: ["date", "null"] },
    },
  },
};
