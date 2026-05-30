/**
 * evidence collection — Mongo $jsonSchema validator.
 *
 * One document per (orgId, userId, id) — the user's curated artifact
 * list for their review export. Manual-only; no auto-star path.
 *
 * `impact` defaults to an empty string at the controller level so a
 * row that was starred without a note still satisfies the
 * required-field check here.
 */

import type { Document } from "mongodb";
import { ALL_EVIDENCE_KINDS } from "../types.js";

export const evidenceValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "id",
      "kind",
      "ref",
      "title",
      "date",
      "impact",
      "starredAt",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      // Stable artifact id. Upper bound is generous — Jira keys can
      // be long ("PROJECTNAME-99999") and merged-pr / review ids are
      // already prefixed.
      id: { bsonType: "string", minLength: 1, maxLength: 256 },
      kind: { enum: [...ALL_EVIDENCE_KINDS] },
      ref: { bsonType: "string", maxLength: 256 },
      title: { bsonType: "string", maxLength: 1_000 },
      date: { bsonType: "string", maxLength: 64 },
      impact: { bsonType: "string", maxLength: 4_000 },
      starredAt: { bsonType: "date" },
    },
  },
};
