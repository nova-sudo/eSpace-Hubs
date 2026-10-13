/**
 * github_links collection — Mongo $jsonSchema validator.
 *
 * One row per (user, goal, period) published to GitHub as an issue. See
 * `GithubLink` in ../types.ts for the ownership rule and the claim-first
 * idempotency design. `state` mirrors GitHub and is rewritten whole on
 * every sync, so it is validated loosely inside and strictly outside.
 */

import type { Document } from "mongodb";

const REPO_PATTERN = "^[a-z0-9._-]+/[a-z0-9._-]+$";

const linkedPr: Document = {
  bsonType: "object",
  required: ["repo", "number", "prId", "url", "title", "state"],
  additionalProperties: false,
  properties: {
    repo: { bsonType: "string", pattern: REPO_PATTERN },
    number: { bsonType: ["int", "long"], minimum: 1 },
    prId: { bsonType: ["int", "long", "double"], minimum: 1 },
    url: { bsonType: "string", maxLength: 500 },
    title: { bsonType: "string", maxLength: 300 },
    state: { enum: ["open", "closed", "merged"] },
    mergedAt: { bsonType: ["date", "null"] },
    author: { bsonType: ["string", "null"], maxLength: 100 },
  },
};

const comment: Document = {
  bsonType: "object",
  required: ["commentId", "author", "body", "createdAt", "url"],
  additionalProperties: false,
  properties: {
    commentId: { bsonType: ["int", "long", "double"], minimum: 1 },
    author: { bsonType: "string", maxLength: 100 },
    body: { bsonType: "string", maxLength: 2000 },
    createdAt: { bsonType: "date" },
    url: { bsonType: "string", maxLength: 500 },
  },
};

const state: Document = {
  bsonType: "object",
  required: ["issueState", "title", "tasks", "labels", "assignees", "commentsCount", "linkedPrs", "comments"],
  additionalProperties: false,
  properties: {
    issueState: { enum: ["open", "closed", "missing"] },
    stateReason: { bsonType: ["string", "null"], maxLength: 40 },
    closedAt: { bsonType: ["date", "null"] },
    updatedAt: { bsonType: ["date", "null"] },
    title: { bsonType: "string", maxLength: 300 },
    tasks: {
      bsonType: "object",
      required: ["done", "total"],
      additionalProperties: false,
      properties: {
        done: { bsonType: ["int", "long"], minimum: 0 },
        total: { bsonType: ["int", "long"], minimum: 0 },
      },
    },
    labels: { bsonType: "array", maxItems: 50, items: { bsonType: "string", maxLength: 100 } },
    assignees: { bsonType: "array", maxItems: 20, items: { bsonType: "string", maxLength: 100 } },
    commentsCount: { bsonType: ["int", "long"], minimum: 0 },
    linkedPrs: { bsonType: "array", maxItems: 10, items: linkedPr },
    comments: { bsonType: "array", maxItems: 20, items: comment },
  },
};

export const githubLinksValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "orgId",
      "userId",
      "goalId",
      "assignedGoalId",
      "periodIndex",
      "periodKey",
      "periodLabel",
      "repo",
      "idempotencyKey",
      "status",
      "claimedAt",
      "issueNumber",
      "issueId",
      "issueNodeId",
      "issueUrl",
      "labelsApplied",
      "createdBy",
      "createdAt",
      "lastSyncedAt",
      "lastSyncError",
      "syncFailures",
      "state",
      "readingInputId",
      "readingClosedAt",
      "posts",
      "specRevision",
      "stale",
      "unlinkedAt",
    ],
    additionalProperties: false,
    properties: {
      _id: { bsonType: "objectId" },
      orgId: { bsonType: "objectId" },
      userId: { bsonType: "objectId" },
      goalId: { bsonType: "string", minLength: 1, maxLength: 200 },
      assignedGoalId: { bsonType: ["objectId", "null"] },
      periodIndex: { bsonType: ["int", "long"], minimum: 0, maximum: 999 },
      periodKey: { bsonType: ["string", "null"], maxLength: 80 },
      periodLabel: { bsonType: "string", maxLength: 200 },
      repo: { bsonType: "string", pattern: REPO_PATTERN, maxLength: 120 },
      idempotencyKey: { bsonType: "string", pattern: "^[0-9a-f]{64}(\\|unlinked\\|[0-9]+)?$" },
      status: { enum: ["pending", "linked", "failed", "unlinked"] },
      claimedAt: { bsonType: "date" },
      issueNumber: { bsonType: ["int", "long", "null"], minimum: 1 },
      issueId: { bsonType: ["int", "long", "double", "null"], minimum: 1 },
      issueNodeId: { bsonType: ["string", "null"], maxLength: 200 },
      issueUrl: { bsonType: ["string", "null"], maxLength: 500 },
      labelsApplied: { bsonType: "bool" },
      createdBy: { bsonType: "objectId" },
      createdAt: { bsonType: "date" },
      lastSyncedAt: { bsonType: ["date", "null"] },
      lastSyncError: { bsonType: ["string", "null"], maxLength: 200 },
      syncFailures: { bsonType: ["int", "long"], minimum: 0 },
      state: { oneOf: [state, { bsonType: "null" }] },
      readingInputId: { bsonType: ["objectId", "null"] },
      readingClosedAt: { bsonType: ["date", "null"] },
      posts: {
        bsonType: "array",
        maxItems: 200,
        items: {
          bsonType: "object",
          required: ["kind", "sourceId", "commentId", "postedAt", "postedBy"],
          additionalProperties: false,
          properties: {
            kind: { enum: ["manager_note", "tier_verdict"] },
            sourceId: { bsonType: "string", maxLength: 80 },
            commentId: { bsonType: ["int", "long", "double"], minimum: 1 },
            postedAt: { bsonType: "date" },
            postedBy: { bsonType: "objectId" },
          },
        },
      },
      specRevision: { bsonType: ["int", "long", "null"], minimum: 0 },
      stale: { bsonType: "bool" },
      unlinkedAt: { bsonType: ["date", "null"] },
    },
  },
};
