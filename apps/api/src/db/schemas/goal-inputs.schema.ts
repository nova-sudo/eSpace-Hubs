/**
 * goal_inputs collection — Mongo $jsonSchema validator.
 *
 * Append-only time series. One document per logged entry — different
 * shape from the localStorage map (`{[goalId]: entries[]}`) so we get
 * cheap range-queries by ts and unbounded history.
 *
 * `value` is intentionally polymorphic — manual widgets store
 * different primitive shapes (number for Counter, string for
 * Free-text, object map for Milestone). The route layer normalises;
 * Mongo just enforces presence.
 */

import type { Document } from "mongodb";
import { ALL_GOAL_INPUT_SOURCES } from "../types.js";

export const goalInputsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "goalId",
      "ts",
      "value",
      "note",
      "source",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      goalId: { bsonType: "string", minLength: 1, maxLength: 200 },
      ts: { bsonType: "date" },
      // value: any of the shapes a manual widget might store.
      // bsonType array allows int/double/string/bool/array/object;
      // null is rejected (use absence via the document not existing).
      value: {
        bsonType: [
          "int",
          "long",
          "double",
          "decimal",
          "string",
          "bool",
          "array",
          "object",
        ],
      },
      note: { bsonType: ["string", "null"], maxLength: 2000 },
      source: { enum: [...ALL_GOAL_INPUT_SOURCES] },
    },
  },
};
