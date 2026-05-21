/**
 * companion_devices collection — Mongo $jsonSchema validator.
 *
 * Each row is a paired desktop-companion installation. The tokenHash
 * is the SHA-256 of the raw bearer token (we never store plaintext).
 * `revokedAt` flips non-null when the user revokes from the Devices
 * UI; the verify path treats those as not-found.
 */

import type { Document } from "mongodb";

export const companionDevicesValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "userId",
      "orgId",
      "tokenHash",
      "name",
      "createdAt",
      "lastUsedAt",
      "revokedAt",
      "createdByIp",
      "createdByUa",
    ],
    additionalProperties: true,
    properties: {
      _id: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      tokenHash: { bsonType: "string", minLength: 32, maxLength: 128 },
      name: { bsonType: "string", minLength: 1, maxLength: 200 },
      createdAt: { bsonType: "date" },
      lastUsedAt: { bsonType: "date" },
      revokedAt: { bsonType: ["date", "null"] },
      createdByIp: { bsonType: ["string", "null"], maxLength: 64 },
      createdByUa: { bsonType: ["string", "null"], maxLength: 512 },
    },
  },
};
