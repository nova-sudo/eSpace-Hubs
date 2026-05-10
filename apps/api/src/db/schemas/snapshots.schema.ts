/**
 * snapshots collection — Mongo $jsonSchema validator.
 *
 * Validates the headline-metric envelope (merged/reviews/etc.).
 * `goalReadings` is left permissive at this layer because the inner
 * shape has lots of nullable fields (target, windowMet, onPace);
 * the route layer's Zod schema is the right place for that.
 *
 * Manual-wins-over-auto precedence is a CONTROLLER rule, not a
 * validator rule — the validator just enforces shape.
 */

import type { Document } from "mongodb";
import { ALL_SNAPSHOT_CAPTURED_BY } from "../types.js";

export const snapshotsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "week",
      "capturedAt",
      "capturedBy",
      "merged",
      "reviews",
      "turnaround",
      "linkage",
      "rounds",
      "note",
      "goalReadings",
      "partial",
      "gaps",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      // Sun-anchored week label, e.g. "W16-2026" or legacy "W16".
      week: {
        bsonType: "string",
        minLength: 2,
        maxLength: 32,
        pattern: "^W[0-9]{1,2}(-[0-9]{4})?$",
      },
      capturedAt: { bsonType: "date" },
      capturedBy: { enum: [...ALL_SNAPSHOT_CAPTURED_BY] },
      merged: { bsonType: ["int", "long", "double"], minimum: 0 },
      reviews: { bsonType: ["int", "long", "double"], minimum: 0 },
      turnaround: { bsonType: ["int", "long", "double"], minimum: 0 },
      linkage: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 100 },
      rounds: { bsonType: ["int", "long", "double"], minimum: 0 },
      note: { bsonType: "string", maxLength: 8_000 },
      goalReadings: { bsonType: "object" },
      partial: { bsonType: "bool" },
      gaps: {
        bsonType: "array",
        maxItems: 20,
        items: { bsonType: "string", maxLength: 64 },
      },
    },
  },
};
