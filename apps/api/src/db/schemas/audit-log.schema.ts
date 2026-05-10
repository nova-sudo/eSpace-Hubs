/**
 * audit_log collection — Mongo $jsonSchema validator.
 *
 * `before` and `after` are intentionally untyped — audit entries are
 * polymorphic by design. The CALL SITE is responsible for redacting
 * secrets before logging; the validator just enforces that the entry
 * itself has a coherent shape.
 *
 * No updates allowed at the route layer (write-once). The validator
 * doesn't enforce that — it can't see the operation kind — but a
 * code-review check + the absence of update endpoints does.
 */

import type { Document } from "mongodb";
import { ALL_USER_ROLES } from "../types.js";

export const auditLogValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["orgId", "actorUserId", "action", "ts"],
    additionalProperties: true,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      actorUserId: { bsonType: ["objectId", "null"] },
      actorRole: {
        oneOf: [{ enum: [...ALL_USER_ROLES] }, { bsonType: "null" }],
      },
      action: {
        bsonType: "string",
        minLength: 3,
        maxLength: 100,
        // Dot-namespaced verb, e.g. "user.invite", "auth.login".
        pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$",
      },
      targetType: { bsonType: ["string", "null"], maxLength: 64 },
      targetId: { bsonType: ["string", "null"], maxLength: 128 },
      // before/after are deliberately untyped.
      ip: { bsonType: ["string", "null"], maxLength: 64 },
      ua: { bsonType: ["string", "null"], maxLength: 512 },
      ts: { bsonType: "date" },
    },
  },
};
