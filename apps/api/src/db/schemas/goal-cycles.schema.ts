/**
 * goal_cycles collection — Mongo $jsonSchema validator.
 *
 * Frozen prior goal trees, archived automatically before a replace
 * import overwrites the active tree (see GoalCycleArchive in
 * db/types.ts). `tree` is validated loosely — the archived shape is
 * whatever the goals validator accepted when it was live, and an
 * archive must never fail because a historical shape predates a
 * schema tightening.
 */

import type { Document } from "mongodb";

export const goalCyclesValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["orgId", "userId", "label", "tree", "l1Count", "l2Count", "archivedAt"],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      label: { bsonType: "string", minLength: 1, maxLength: 200 },
      tree: { bsonType: "object" },
      // F2 v2 — the frozen report card (goalId → outcome at archive
      // time). Loosely validated for the same reason `tree` is: an
      // archive must never fail on shape.
      report: { bsonType: "object" },
      l1Count: { bsonType: "int", minimum: 0 },
      l2Count: { bsonType: "int", minimum: 0 },
      archivedAt: { bsonType: "date" },
    },
  },
};
