/**
 * hub_configs collection — Mongo $jsonSchema validator.
 *
 * Per-(orgId, hubId) overrides on top of the shared registry defaults
 * in @espace-devhub/shared/hubs. Each override field is optional;
 * absent fields fall through to the registry default at resolution
 * time (see modules/hubs/controller.ts).
 *
 * Semantics
 *   enabled              — when explicitly false, the hub is HIDDEN
 *                          from every user in the org (filtered out
 *                          of /hubs/me). When absent or true, the hub
 *                          shows as normal.
 *   label / description  — string overrides for UI labelling.
 *   allowedIntegrations  — REPLACES (not merges) the registry default.
 *                          Empty array is a valid value ("this hub has
 *                          no integrations").
 *   pages                — PARTIAL merge: only the slot ids present in
 *                          this override are touched. A value of `null`
 *                          on a slot REMOVES it from the effective pages
 *                          map (hides the page in this hub). Any slot
 *                          not present passes through from defaults.
 *   departments          — REPLACES the registry default (since the
 *                          orchestrator routes a user via this list,
 *                          partial-merge semantics would be confusing).
 */

import type { Document } from "mongodb";

export const hubConfigsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["orgId", "hubId", "updatedAt"],
    additionalProperties: true,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      hubId: { bsonType: "string", minLength: 1, maxLength: 64 },
      enabled: { bsonType: ["bool", "null"] },
      label: { bsonType: ["string", "null"], maxLength: 200 },
      description: { bsonType: ["string", "null"], maxLength: 500 },
      allowedIntegrations: {
        bsonType: ["array", "null"],
        items: { bsonType: "string", minLength: 1, maxLength: 64 },
        maxItems: 64,
      },
      pages: { bsonType: ["object", "null"] },
      departments: {
        bsonType: ["array", "null"],
        items: { bsonType: "string", minLength: 1, maxLength: 200 },
        maxItems: 256,
      },
      updatedBy: { bsonType: ["objectId", "null"] },
      updatedAt: { bsonType: "date" },
    },
  },
};
