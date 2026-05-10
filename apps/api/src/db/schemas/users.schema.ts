/**
 * users collection — Mongo $jsonSchema validator.
 *
 * See ./orgs.schema.ts for the philosophy on validator scope. We
 * enumerate role/status enums here because typos at the DB layer
 * (e.g. accidentally writing "memer") would silently break every
 * role-gated route.
 */

import type { Document } from "mongodb";
import { ALL_USER_ROLES, ALL_USER_STATUSES } from "../types.js";

export const usersValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "email",
      "passwordHash",
      "role",
      "status",
      "totpSecret",
      "totpEnrolledAt",
      "zohoEmployeeId",
      "managerId",
      "level",
      "hireDate",
      "displayName",
      "createdAt",
      "updatedAt",
      "invitedBy",
      "invitedAt",
      "lastLoginAt",
      "failedLoginAttempts",
      "lockedUntil",
    ],
    additionalProperties: true,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      email: {
        bsonType: "string",
        // Loose RFC-ish check; the route layer applies a stricter pattern.
        pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
        minLength: 3,
        maxLength: 320,
      },
      passwordHash: { bsonType: ["string", "null"] },
      role: { enum: [...ALL_USER_ROLES] },
      status: { enum: [...ALL_USER_STATUSES] },
      totpSecret: { bsonType: ["string", "null"] },
      totpEnrolledAt: { bsonType: ["date", "null"] },
      zohoEmployeeId: { bsonType: ["string", "null"] },
      managerId: { bsonType: ["objectId", "null"] },
      level: { bsonType: ["string", "null"] },
      hireDate: { bsonType: ["date", "null"] },
      displayName: { bsonType: "string", minLength: 1, maxLength: 200 },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
      invitedBy: { bsonType: ["objectId", "null"] },
      invitedAt: { bsonType: ["date", "null"] },
      lastLoginAt: { bsonType: ["date", "null"] },
      failedLoginAttempts: { bsonType: "int", minimum: 0 },
      lockedUntil: { bsonType: ["date", "null"] },
    },
  },
};
