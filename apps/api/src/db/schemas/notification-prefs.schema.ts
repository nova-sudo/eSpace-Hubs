/**
 * notification_prefs collection — Mongo $jsonSchema validator.
 *
 * One row per user (unique on orgId+userId, declared in collections.ts):
 * the notification kinds they muted and whether the app may email them.
 * An absent row means the defaults (nothing muted, email on). Written by
 * PUT /api/v1/notifications/preferences; read by lib/notifications.ts
 * before every inbox insert and every non-security email.
 */

import type { Document } from "mongodb";

export const notificationPrefsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["orgId", "userId", "muted", "email", "updatedAt"],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      muted: {
        bsonType: "array",
        maxItems: 64,
        items: { bsonType: "string", minLength: 1, maxLength: 64 },
      },
      email: { bsonType: "bool" },
      updatedAt: { bsonType: "date" },
    },
  },
};
