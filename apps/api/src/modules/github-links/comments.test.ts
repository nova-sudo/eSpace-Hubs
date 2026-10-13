/**
 * comments.ts — posting a manager's shared note / tier verdict to a linked
 * issue. In-memory collections and a recording client: idempotency on
 * (link, kind, sourceId), the private-note refusal, the manager boundary,
 * and the server-composed body carrying the comment marker last.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId, type Collection } from "mongodb";
import { parseCommentMarker } from "@espace-devhub/shared/github-links";
import type {
  GithubLink,
  ManagerGoalVerdictEvent,
  ManagerReportNote,
  User,
} from "../../db/types.js";
import { asCollection, FakeCollection } from "../../lib/fake-collection.test-support.js";
import { HttpError } from "../../middleware/error-handler.js";
import {
  loadLinkForViewer,
  postLinkComment,
  renderTierVerdictComment,
  type CommentDeps,
  type CommentSession,
} from "./comments.js";
import type { GithubClient } from "./github-client.js";

const org = new ObjectId();
const dev = new ObjectId();
const manager = new ObjectId();
const stranger = new ObjectId();
const creator = new ObjectId();
const NOW = new Date("2026-02-10T12:00:00Z");

const asSession = (userId: ObjectId): CommentSession => ({ orgId: org, userId, role: "manager" });

function linkRow(over: Partial<GithubLink> = {}): GithubLink {
  return {
    _id: new ObjectId(),
    orgId: org,
    userId: dev,
    goalId: "l2-1",
    assignedGoalId: null,
    periodIndex: 0,
    periodKey: "2026-01",
    periodLabel: "January",
    repo: "espace/devhub",
    idempotencyKey: "a".repeat(64),
    status: "linked",
    claimedAt: NOW,
    issueNumber: 42,
    issueId: 9001,
    issueNodeId: "I_kw",
    issueUrl: "https://github.com/espace/devhub/issues/42",
    labelsApplied: true,
    createdBy: dev,
    createdAt: NOW,
    lastSyncedAt: null,
    lastSyncError: null,
    syncFailures: 0,
    state: null,
    readingInputId: null,
    readingClosedAt: null,
    posts: [],
    specRevision: null,
    stale: false,
    unlinkedAt: null,
    ...over,
  };
}

function harness(opts: { connected?: boolean } = {}) {
  const links = new FakeCollection();
  const notes = new FakeCollection();
  const events = new FakeCollection();
  const assigned = new FakeCollection();
  const users: User[] = [
    { _id: dev, orgId: org, managerId: manager, status: "active" } as unknown as User,
    { _id: manager, orgId: org, managerId: null, status: "active" } as unknown as User,
  ];
  const posted: Array<{ repo: string; number: number; body: string }> = [];
  const audits: string[] = [];
  const client = {
    createComment: async (repo: string, number: number, body: string) => {
      posted.push({ repo, number, body });
      return { id: 5000 + posted.length, html_url: "https://github.com/x" };
    },
  } as unknown as GithubClient;
  const deps: CommentDeps = {
    links: asCollection<Collection<GithubLink>>(links),
    notes: asCollection<Collection<ManagerReportNote>>(notes),
    verdictEvents: asCollection<Collection<ManagerGoalVerdictEvent>>(events),
    findUser: async (q) => users.find((u) => u._id.equals(q._id) && u.orgId.equals(q.orgId)) ?? null,
    findAssignedGoal: async (q) => assigned.findOne(q),
    clientFor: async () => {
      if (opts.connected === false) {
        throw new HttpError(400, "integration_not_connected", "Connect GitHub.");
      }
      return client;
    },
    now: () => NOW,
    audit: async (a) => {
      audits.push(a.action);
    },
  };
  return { links, notes, events, assigned, deps, posted, audits };
}

function verdictEvent(over: Partial<ManagerGoalVerdictEvent> = {}): ManagerGoalVerdictEvent {
  return {
    _id: new ObjectId(),
    orgId: org,
    subjectUserId: dev,
    goalId: "l2-1",
    periodKey: "2026",
    tier: "over_achieved",
    note: "Shipped early and documented it.",
    gradedBy: manager,
    gradedByName: "Mona Manager",
    gradedAt: new Date("2026-02-09T15:00:00Z"),
    supersededAt: null,
    legacy: false,
    ack: null,
    ...over,
  };
}

function note(over: Partial<ManagerReportNote> = {}): ManagerReportNote {
  return {
    _id: new ObjectId(),
    orgId: org,
    managerId: manager,
    reportId: dev,
    managerName: "Mona Manager",
    body: "Great 1:1 — let's pair on the migration next week.",
    visibility: "shared-with-report",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

test("renderTierVerdictComment: tier label, note, attribution, marker last", () => {
  const ev = verdictEvent();
  const body = renderTierVerdictComment(ev);
  assert.ok(body.startsWith("**Tier:** Over achieved — Shipped early and documented it."));
  assert.match(body, /_Graded by Mona Manager on Feb 9, 2026 in eSpace_/);
  const lines = body.trim().split("\n");
  assert.deepEqual(parseCommentMarker(lines[lines.length - 1]), {
    kind: "tier_verdict",
    sourceId: ev._id.toHexString(),
  });
  assert.ok(renderTierVerdictComment(verdictEvent({ note: "" })).startsWith("**Tier:** Over achieved\n"));
});

test("a manager posts a tier verdict once; a repeat returns the recorded post without calling GitHub", async () => {
  const h = harness();
  const row = linkRow();
  h.links.docs.push({ ...row });
  const ev = verdictEvent();
  h.events.docs.push({ ...ev });

  const first = await postLinkComment(h.deps, asSession(manager), {
    linkId: row._id.toHexString(),
    kind: "tier_verdict",
    sourceId: ev._id.toHexString(),
  });
  assert.equal(first.existing, false);
  assert.equal(first.post.commentId, 5001);
  assert.ok(first.post.postedBy.equals(manager));
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0]?.repo, "espace/devhub");
  assert.equal(h.posted[0]?.number, 42);
  assert.deepEqual(parseCommentMarker(h.posted[0]?.body), {
    kind: "tier_verdict",
    sourceId: ev._id.toHexString(),
  });
  assert.deepEqual(h.audits, ["github_links.comment.post"]);
  const stored = h.links.docs[0] as GithubLink;
  assert.equal(stored.posts.length, 1);

  const again = await postLinkComment(h.deps, asSession(manager), {
    linkId: row._id.toHexString(),
    kind: "tier_verdict",
    sourceId: ev._id.toHexString(),
  });
  assert.equal(again.existing, true);
  assert.equal(again.post.commentId, 5001);
  assert.equal(h.posted.length, 1);
  assert.equal(h.audits.length, 1);
  assert.equal((h.links.docs[0] as GithubLink).posts.length, 1);
});

test("a verdict for another goal / user is a 404", async () => {
  const h = harness();
  const row = linkRow();
  h.links.docs.push({ ...row });
  const other = verdictEvent({ goalId: "l2-other" });
  h.events.docs.push({ ...other });
  await assert.rejects(
    postLinkComment(h.deps, asSession(manager), {
      linkId: row._id.toHexString(),
      kind: "tier_verdict",
      sourceId: other._id.toHexString(),
    }),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
  assert.equal(h.posted.length, 0);
});

test("a shared note is posted; a private note is refused with note_private", async () => {
  const h = harness();
  const row = linkRow();
  h.links.docs.push({ ...row });
  const shared = note();
  const secret = note({ visibility: "private", body: "Concerned about focus." });
  h.notes.docs.push({ ...shared }, { ...secret });

  await assert.rejects(
    postLinkComment(h.deps, asSession(manager), {
      linkId: row._id.toHexString(),
      kind: "manager_note",
      sourceId: secret._id.toHexString(),
    }),
    (e: unknown) => e instanceof HttpError && e.status === 400 && e.code === "note_private",
  );
  assert.equal(h.posted.length, 0);

  const out = await postLinkComment(h.deps, asSession(manager), {
    linkId: row._id.toHexString(),
    kind: "manager_note",
    sourceId: shared._id.toHexString(),
  });
  assert.equal(out.existing, false);
  assert.ok(h.posted[0]?.body.startsWith("Great 1:1"));
  assert.equal(h.posted[0]?.body.includes("Concerned"), false);
});

test("someone else's note about this report is a 404", async () => {
  const h = harness();
  const row = linkRow();
  h.links.docs.push({ ...row });
  const theirs = note({ managerId: new ObjectId() });
  h.notes.docs.push({ ...theirs });
  await assert.rejects(
    postLinkComment(h.deps, asSession(manager), {
      linkId: row._id.toHexString(),
      kind: "manager_note",
      sourceId: theirs._id.toHexString(),
    }),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
});

test("a non-manager (and the owner) cannot post — 404, GitHub untouched", async () => {
  const h = harness();
  const row = linkRow();
  h.links.docs.push({ ...row });
  const ev = verdictEvent();
  h.events.docs.push({ ...ev });
  for (const who of [stranger, dev]) {
    await assert.rejects(
      postLinkComment(h.deps, asSession(who), {
        linkId: row._id.toHexString(),
        kind: "tier_verdict",
        sourceId: ev._id.toHexString(),
      }),
      (e: unknown) => e instanceof HttpError && e.status === 404,
    );
  }
  assert.equal(h.posted.length, 0);
});

test("a shared goal's creator may post even when not the line manager", async () => {
  const h = harness();
  const asgId = new ObjectId();
  h.assigned.docs.push({ _id: asgId, orgId: org, createdBy: creator });
  const row = linkRow({ goalId: `asg_${asgId.toHexString()}`, assignedGoalId: asgId });
  h.links.docs.push({ ...row });
  const ev = verdictEvent({ goalId: row.goalId, gradedBy: creator });
  h.events.docs.push({ ...ev });
  const out = await postLinkComment(h.deps, asSession(creator), {
    linkId: row._id.toHexString(),
    kind: "tier_verdict",
    sourceId: ev._id.toHexString(),
  });
  assert.equal(out.existing, false);
  assert.equal(h.posted.length, 1);
});

test("without the caller's GitHub token the post is a 400 and nothing is recorded", async () => {
  const h = harness({ connected: false });
  const row = linkRow();
  h.links.docs.push({ ...row });
  const ev = verdictEvent();
  h.events.docs.push({ ...ev });
  await assert.rejects(
    postLinkComment(h.deps, asSession(manager), {
      linkId: row._id.toHexString(),
      kind: "tier_verdict",
      sourceId: ev._id.toHexString(),
    }),
    (e: unknown) => e instanceof HttpError && e.code === "integration_not_connected",
  );
  assert.equal((h.links.docs[0] as GithubLink).posts.length, 0);
});

test("loadLinkForViewer: the owner reads, a stranger gets 404, an unlinked row is gone", async () => {
  const h = harness();
  const row = linkRow();
  const gone = linkRow({ status: "unlinked" });
  h.links.docs.push({ ...row }, { ...gone });
  const owner = await loadLinkForViewer(h.deps, asSession(dev), row._id.toHexString(), { allowOwner: true });
  assert.equal(owner.role, "owner");
  const mgr = await loadLinkForViewer(h.deps, asSession(manager), row._id.toHexString(), { allowOwner: true });
  assert.equal(mgr.role, "manager");
  await assert.rejects(
    loadLinkForViewer(h.deps, asSession(stranger), row._id.toHexString(), { allowOwner: true }),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
  await assert.rejects(
    loadLinkForViewer(h.deps, asSession(dev), gone._id.toHexString(), { allowOwner: true }),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
  await assert.rejects(
    loadLinkForViewer(h.deps, asSession(dev), "not-an-id", { allowOwner: true }),
    (e: unknown) => e instanceof HttpError && e.status === 404,
  );
});
