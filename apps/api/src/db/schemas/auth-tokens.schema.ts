/**
 * auth_tokens collection — Mongo $jsonSchema validator.
 *
 * Backstop for invite + password-reset tokens. The `_id` is the
 * SHA-256 hash of the plaintext token (the plaintext only exists in
 * the email link), so even a Mongo-only read doesn't yield a usable
 * token.
 */

import type { Document } from "mongodb";
import { ALL_AUTH_TOKEN_KINDS } from "../types.js";

export const authTokensValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "_id",
      "userId",
      "orgId",
      "kind",
      "createdAt",
      "expiresAt",
      "usedAt",
      "createdByIp",
      "createdByUa",
    ],
    additionalProperties: false,
    properties: {
      _id: {
        bsonType: "string",
        // base64url SHA-256 = 43 chars, no padding.
        minLength: 43,
        maxLength: 43,
        pattern: "^[A-Za-z0-9_-]+$",
      },
      userId: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      kind: { enum: [...ALL_AUTH_TOKEN_KINDS] },
      createdAt: { bsonType: "date" },
      expiresAt: { bsonType: "date" },
      usedAt: { bsonType: ["date", "null"] },
      createdByIp: { bsonType: ["string", "null"], maxLength: 64 },
      createdByUa: { bsonType: ["string", "null"], maxLength: 512 },
    },
  },
};
