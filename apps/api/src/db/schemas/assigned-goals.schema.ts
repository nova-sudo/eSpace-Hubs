/**
 * assigned_goals collection — Mongo $jsonSchema validator.
 *
 * A manager-authored goal shared with ASSIGNEES (who fill it, inside their
 * own goal tree) and VIEWERS (who read its analytics). `spec` is a
 * validated COMPOSED spec — full validation happens at the route layer via
 * the shared `validateSpec`; Mongo only enforces it's an object.
 */

import type { Document } from "mongodb";

export const assignedGoalsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "createdBy",
      "code",
      "title",
      "spec",
      "assigneeIds",
      "viewerIds",
      "graceHours",
      "status",
      "specRevision",
      "createdAt",
      "updatedAt",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      createdBy: { bsonType: "objectId" },
      createdByName: { bsonType: "string", maxLength: 200 },
      code: { bsonType: "string", maxLength: 200 },
      title: { bsonType: "string", minLength: 1, maxLength: 300 },
      description: { bsonType: "string", maxLength: 4000 },
      spec: { bsonType: "object" },
      assigneeIds: { bsonType: "array", maxItems: 500, items: { bsonType: "objectId" } },
      viewerIds: { bsonType: "array", maxItems: 100, items: { bsonType: "objectId" } },
      graceHours: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 720 },
      timeZone: { bsonType: "string", maxLength: 64 },
      status: { enum: ["active", "archived"] },
      archivedAt: { bsonType: ["date", "null"] },
      specRevision: { bsonType: ["int", "long"], minimum: 0 },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
};
