/**
 * sessions collection — Mongo $jsonSchema validator.
 *
 * `_id` is a STRING here, not an ObjectId — sessions need an opaque
 * cookie-safe identifier. The auth module mints 32 random bytes
 * encoded as 64 hex chars.
 */

import type { Document } from "mongodb";
import { ALL_USER_ROLES } from "../types.js";

export const sessionsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "_id",
      "userId",
      "orgId",
      "role",
      "createdAt",
      "expiresAt",
      "lastSeenAt",
      "ip",
      "userAgent",
      "demo",
      "totpVerified",
    ],
    additionalProperties: false,
    properties: {
      _id: {
        bsonType: "string",
        minLength: 32,
        maxLength: 128,
        pattern: "^[A-Za-z0-9_-]+$",
      },
      userId: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      role: { enum: [...ALL_USER_ROLES] },
      createdAt: { bsonType: "date" },
      expiresAt: { bsonType: "date" },
      lastSeenAt: { bsonType: "date" },
      ip: { bsonType: ["string", "null"] },
      userAgent: { bsonType: ["string", "null"] },
      demo: { bsonType: "bool" },
      totpVerified: { bsonType: "bool" },
      // Optional for backward-compat with sessions minted before this
      // field existed. New mintSession calls always write it; the
      // startup migration `backfill-totp-enrolled-sessions` backfills
      // pre-existing rows.
      totpEnrolled: { bsonType: ["bool", "null"] },
    },
  },
};
