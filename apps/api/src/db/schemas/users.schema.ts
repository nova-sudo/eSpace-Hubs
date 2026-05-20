/**
 * users collection — Mongo $jsonSchema validator.
 *
 * See ./orgs.schema.ts for the philosophy on validator scope. We
 * enumerate role/status enums here because typos at the DB layer
 * (e.g. accidentally writing "memer") would silently break every
 * role-gated route.
 */

import type { Document } from "mongodb";
import {
  ALL_ENGAGEMENTS,
  ALL_USER_ROLES,
  ALL_USER_STATUSES,
} from "../types.js";

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
      // M-CAP: multi-role array. Optional during the cutover —
      // readers fall back to `[role]` when missing. Boot-time
      // migration populates this for every existing row, and
      // new user-creation paths write both fields until `role` is
      // removed in a follow-up release.
      roles: {
        bsonType: ["array", "null"],
        items: { enum: [...ALL_USER_ROLES] },
        maxItems: 16,
      },
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
      // M10.1: hub access. Both fields are OPTIONAL on existing rows
      // so we don't force a backward-incompatible migration; the
      // controller reads with defaults (allowedHubs ?? [DEFAULT_HUB_ID],
      // primaryHub ?? DEFAULT_HUB_ID). New user-creation paths (invite
      // accept, admin-create CLI) set them explicitly.
      allowedHubs: {
        bsonType: ["array", "null"],
        items: { bsonType: "string", minLength: 1, maxLength: 64 },
        maxItems: 32,
      },
      primaryHub: { bsonType: ["string", "null"], maxLength: 64 },
      // M-OB: onboarding state. Optional everywhere — null/missing
      // for invited users who haven't completed onboarding yet; set
      // to a Date once they submit the form. The AuthGuard reads
      // this to decide whether to trap the user at /onboarding.
      onboardingCompletedAt: { bsonType: ["date", "null"] },
      // Employee profile fields collected by the onboarding form.
      // Department drives hub assignment via the registry's
      // departments mapping. Both nullable so pre-M-OB users still
      // validate.
      employeeId: { bsonType: ["string", "null"], maxLength: 64 },
      department: { bsonType: ["string", "null"], maxLength: 200 },
      // Engagement assignment. Nullable for backward-compat with
      // pre-engagement rows; readers default to "espace".
      engagement: {
        bsonType: ["string", "null"],
        enum: [...ALL_ENGAGEMENTS, null],
      },
    },
  },
};
