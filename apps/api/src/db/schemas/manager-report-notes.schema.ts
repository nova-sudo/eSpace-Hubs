/**
 * manager_report_notes collection — Mongo $jsonSchema validator.
 *
 * A manager's 1:1 / check-in notes about one direct report. Written by
 * /api/v1/manager/reports/:userId/notes (resolveReport-guarded); the
 * report reads the "shared-with-report" ones via /api/v1/my-manager-notes.
 */

import type { Document } from "mongodb";

export const managerReportNotesValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "managerId",
      "reportId",
      "managerName",
      "body",
      "visibility",
      "createdAt",
      "updatedAt",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      managerId: { bsonType: "objectId" },
      reportId: { bsonType: "objectId" },
      managerName: { bsonType: "string", maxLength: 200 },
      body: { bsonType: "string", minLength: 1, maxLength: 10000 },
      visibility: { enum: ["private", "shared-with-report"] },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
};
