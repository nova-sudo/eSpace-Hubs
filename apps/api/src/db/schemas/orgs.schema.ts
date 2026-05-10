/**
 * orgs collection — Mongo $jsonSchema validator.
 *
 * Backstop only. Primary validation lives at the route layer in Zod.
 * If we ever accept a write that doesn't go through a controller (a
 * migration script, a manual mongosh ops touch), this catches obvious
 * shape errors.
 *
 * Keep validators PERMISSIVE on optional fields and STRICT on required
 * shape. We don't enumerate every legal value here (that's Zod's job)
 * — we just enforce types and presence.
 */

import type { Document } from "mongodb";

export const orgsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["slug", "name", "settings", "createdAt", "updatedAt"],
    additionalProperties: true,
    properties: {
      _id: { bsonType: "objectId" },
      slug: {
        bsonType: "string",
        minLength: 1,
        maxLength: 64,
        pattern: "^[a-z0-9][a-z0-9_-]*$",
      },
      name: { bsonType: "string", minLength: 1, maxLength: 200 },
      settings: {
        bsonType: "object",
        required: ["weekStart"],
        properties: {
          weekStart: { bsonType: "int", minimum: 0, maximum: 6 },
          performanceCycle: {
            bsonType: "object",
            required: ["startMonth", "lengthMonths"],
            properties: {
              startMonth: { bsonType: "int", minimum: 1, maximum: 12 },
              lengthMonths: { bsonType: "int", minimum: 1, maximum: 24 },
            },
          },
        },
      },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
  },
};
