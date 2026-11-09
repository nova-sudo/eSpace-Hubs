/**
 * trusted_devices collection — Mongo $jsonSchema validator.
 *
 * One row per browser a user trusted after a TOTP success (skip the
 * prompt for 30 days). Only the sha256 of the cookie token is stored.
 * TTL on `expiresAt` (declared in collections.ts).
 */

import type { Document } from "mongodb";

export const trustedDevicesValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["orgId", "userId", "tokenHash", "createdAt", "lastUsedAt", "expiresAt"],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      tokenHash: { bsonType: "string", minLength: 64, maxLength: 64 },
      userAgent: { bsonType: ["string", "null"], maxLength: 1000 },
      ip: { bsonType: ["string", "null"], maxLength: 100 },
      createdAt: { bsonType: "date" },
      lastUsedAt: { bsonType: "date" },
      expiresAt: { bsonType: "date" },
    },
  },
};
