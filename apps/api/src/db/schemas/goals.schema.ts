/**
 * goals collection — Mongo $jsonSchema validator.
 *
 * Validates the top-level container (orgId, userId, schemaVersion,
 * l1s array). Inner L1/L2 fields are loosely-typed `object` here —
 * Zod at the route layer enforces the deeper shape. The Mongo
 * validator is a backstop against direct mongosh writes that miss
 * required containers.
 *
 * One tree per (orgId, userId) for v1. When M9's Zoho cycle support
 * lands we'll extend the unique key with cycleId; this validator
 * doesn't need to change.
 */

import type { Document } from "mongodb";
import { GOALS_SCHEMA_VERSION } from "../types.js";

export const goalsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "schemaVersion",
      "l1s",
      "cycleId",
      "updatedAt",
    ],
    additionalProperties: true,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      schemaVersion: {
        bsonType: "int",
        minimum: GOALS_SCHEMA_VERSION,
        maximum: GOALS_SCHEMA_VERSION,
      },
      l1s: {
        bsonType: "array",
        // Reasonable upper bound — review processes don't survive
        // beyond this. If the validator catches a runaway insert
        // (loop bug, malformed import) we'd rather hard-fail than
        // store 10k goals.
        maxItems: 200,
        items: {
          bsonType: "object",
          required: ["id", "title"],
          properties: {
            id: { bsonType: "string", minLength: 1, maxLength: 200 },
            title: { bsonType: "string", maxLength: 1000 },
            l2s: {
              bsonType: "array",
              maxItems: 200,
              items: {
                bsonType: "object",
                required: ["id"],
                properties: {
                  id: {
                    bsonType: "string",
                    minLength: 1,
                    maxLength: 200,
                  },
                },
              },
            },
          },
        },
      },
      cycleId: { bsonType: ["objectId", "null"] },
      updatedAt: { bsonType: "date" },
    },
  },
};
