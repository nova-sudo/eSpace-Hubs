/**
 * integrations collection — Mongo $jsonSchema validator.
 *
 * Validates structural shape only. The `encrypted*` and `refreshToken`
 * fields are envelope strings — versioned wire format
 * `v1.<iv>.<tag>.<ct>` — Mongo doesn't try to parse them, just checks
 * type + length bounds.
 *
 * `additionalProperties: false` is intentional. Operators / migration
 * scripts that try to write a stray plaintext `accessToken` field
 * land in this validator and get rejected — the encrypted-only rule
 * is enforced at the data layer, not just the route layer.
 */

import type { Document } from "mongodb";

export const integrationsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "providerId",
      "label",
      "encryptedToken",
      "encryptedApiToken",
      "refreshToken",
      "email",
      "endpointUrl",
      "scopes",
      "connectedAt",
      "expiresAt",
      "lastUsedAt",
      "lastErrorAt",
      "lastError",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      providerId: { bsonType: "string", minLength: 1, maxLength: 64 },
      label: { bsonType: "string", maxLength: 200 },
      // Envelope strings — `v1.<iv>.<tag>.<ct>` — keep liberal upper
      // bounds (4 KB is more than enough for any token we'd see).
      encryptedToken: { bsonType: ["string", "null"], maxLength: 4_096 },
      encryptedApiToken: { bsonType: ["string", "null"], maxLength: 4_096 },
      refreshToken: { bsonType: ["string", "null"], maxLength: 4_096 },
      email: { bsonType: ["string", "null"], maxLength: 320 },
      endpointUrl: { bsonType: ["string", "null"], maxLength: 1_000 },
      scopes: {
        bsonType: "array",
        maxItems: 50,
        items: { bsonType: "string", maxLength: 200 },
      },
      connectedAt: { bsonType: "date" },
      expiresAt: { bsonType: ["date", "null"] },
      lastUsedAt: { bsonType: ["date", "null"] },
      lastErrorAt: { bsonType: ["date", "null"] },
      lastError: { bsonType: ["string", "null"], maxLength: 2_000 },
      // Cleartext identity metadata — non-secret. Not in `required`:
      // rows written before these fields shipped legitimately lack them.
      username: { bsonType: ["string", "null"], maxLength: 200 },
      displayName: { bsonType: ["string", "null"], maxLength: 200 },
      avatarUrl: { bsonType: ["string", "null"], maxLength: 2_000 },
      team: { bsonType: ["string", "null"], maxLength: 200 },
    },
  },
};
