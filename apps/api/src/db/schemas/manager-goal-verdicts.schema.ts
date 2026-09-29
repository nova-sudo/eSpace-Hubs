/**
 * manager_goal_verdicts + manager_goal_verdict_events — Mongo $jsonSchema
 * validators.
 *
 * `manager_goal_verdicts` is the CURRENT grade of record: one row per
 * (orgId, subjectUserId, goalId), rewritten on re-grade. Every reader that
 * shows "the manager's tier" (dev badge, manager board, shared goals,
 * cycle archive) reads it. Unlike goal_tier_verdicts it is a RECORD, not a
 * cache — no TTL. It outranks the AI verdict wherever a tier is shown.
 *
 * `manager_goal_verdict_events` is the append-only history behind it: one
 * row per grade ever set, keyed by (orgId, subjectUserId, goalId,
 * periodKey). A re-grade stamps `supersededAt` on the previous row of the
 * same period instead of overwriting it. See lib/manager-verdicts.ts.
 */

import type { Document } from "mongodb";

const TIER_ENUM = ["not_achieved", "achieved", "over_achieved", "role_model"];

/** "2026", or a finer "2026-Q1" / "2026-H2" / "2026-M03" window. */
export const VERDICT_PERIOD_KEY_PATTERN = "^[0-9]{4}(-[A-Za-z0-9]{1,8})?$";

const ackSchema: Document = {
  bsonType: ["object", "null"],
  required: ["at", "disagree", "note"],
  additionalProperties: false,
  properties: {
    at: { bsonType: "date" },
    disagree: { bsonType: "bool" },
    note: { bsonType: "string", maxLength: 2_000 },
  },
};

export const managerGoalVerdictsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "subjectUserId",
      "goalId",
      "tier",
      "note",
      "gradedBy",
      "gradedByName",
      "gradedAt",
      "updatedAt",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      subjectUserId: { bsonType: "objectId" },
      goalId: { bsonType: "string", minLength: 1, maxLength: 200 },
      tier: { enum: TIER_ENUM },
      note: { bsonType: "string", maxLength: 4_000 },
      gradedBy: { bsonType: "objectId" },
      gradedByName: { bsonType: "string", maxLength: 200 },
      gradedAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
      // Optional — absent on rows written before grade history existed.
      periodKey: { bsonType: "string", pattern: VERDICT_PERIOD_KEY_PATTERN },
      eventId: { bsonType: ["objectId", "null"] },
      ack: ackSchema,
    },
  },
};

export const managerGoalVerdictEventsValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "subjectUserId",
      "goalId",
      "periodKey",
      "tier",
      "note",
      "gradedBy",
      "gradedByName",
      "gradedAt",
      "supersededAt",
      "legacy",
      "ack",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      subjectUserId: { bsonType: "objectId" },
      goalId: { bsonType: "string", minLength: 1, maxLength: 200 },
      periodKey: { bsonType: "string", pattern: VERDICT_PERIOD_KEY_PATTERN },
      tier: { enum: TIER_ENUM },
      note: { bsonType: "string", maxLength: 4_000 },
      gradedBy: { bsonType: "objectId" },
      gradedByName: { bsonType: "string", maxLength: 200 },
      gradedAt: { bsonType: "date" },
      supersededAt: { bsonType: ["date", "null"] },
      legacy: { bsonType: "bool" },
      ack: ackSchema,
    },
  },
};
