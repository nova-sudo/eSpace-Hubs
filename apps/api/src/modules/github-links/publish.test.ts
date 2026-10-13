/**
 * publishGoalToGithub against an in-memory links collection and a
 * recording GitHub client. No database, no network: the claim-first
 * idempotency, the crash-recovery adoption and the rate-limit stop are
 * the properties that matter, and they all have to hold without Mongo's
 * unique index doing the work (the fake has none).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId, type Collection } from "mongodb";
import { buildMarker } from "@espace-devhub/shared/github-links";
import type { GithubLink } from "../../db/types.js";
import { asCollection, FakeCollection } from "../../lib/fake-collection.test-support.js";
import { HttpError } from "../../middleware/error-handler.js";
import type { GithubClient, GithubIssue } from "./github-client.js";
import {
  idempotencyKey,
  PENDING_CLAIM_TTL_MS,
  publishGoalToGithub,
  type PublishDeps,
  type PublishInput,
  type PublishTarget,
} from "./publish.js";

const org = new ObjectId();
const user = new ObjectId();
const NOW = new Date("2026-02-10T12:00:00Z");

const spec: Record<string, unknown> = {
  widget: "COMPOSED",
  fields: [{ id: "done", kind: "checkbox", label: "Done" }],
  composed: {
    cadence: "monthly",
    cycleStart: "2026-01-01",
    cycleEnd: "2026-03-31",
    periods: [
      { key: "m1", label: "January", dueAt: "2026-01-25", detail: { deliverables: ["Plan"] } },
      { key: "m2", label: "February" },
      { key: "m3", label: "March" },
    ],
  },
};

function target(overrides: Partial<PublishTarget> = {}): PublishTarget {
  return {
    spec,
    goalTitle: "Ship the thing",
    goalCode: "R-1",
    assignedGoalId: null,
    specRevision: null,
    creatorId: null,
    defaultRepo: null,
    ...overrides,
  };
}

interface FakeClientOptions {
  existing?: GithubIssue[];
  /** Throw on the Nth createIssue call (1-based). */
  failOn?: { call: number; error: Error };
}

function fakeClient(opts: FakeClientOptions = {}) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  let nextNumber = 100;
  const client: GithubClient = {
    async ensureLabel(repo, label) {
      calls.push({ op: "ensureLabel", args: [repo, label.name] });
      return true;
    },
    async createIssue(repo, input) {
      calls.push({ op: "createIssue", args: [repo, input.title, input.labels] });
      const n = calls.filter((c) => c.op === "createIssue").length;
      if (opts.failOn && opts.failOn.call === n) throw opts.failOn.error;
      nextNumber += 1;
      const issue: GithubIssue = {
        id: nextNumber * 10,
        node_id: `I_${nextNumber}`,
        number: nextNumber,
        html_url: `https://github.com/${repo}/issues/${nextNumber}`,
        title: input.title,
        body: input.body,
        state: "open",
      };
      return { issue, labelsApplied: true };
    },
    async getIssue() {
      throw new Error("not used");
    },
    async listIssuesByLabels(repo, labels) {
      calls.push({ op: "listIssuesByLabels", args: [repo, labels] });
      return opts.existing ?? [];
    },
    async listTimeline() {
      return [];
    },
    async listComments() {
      return [];
    },
    async getPull() {
      return null;
    },
    async createComment() {
      throw new Error("not used");
    },
  };
  return { client, calls };
}

function harness(clientOpts: FakeClientOptions = {}) {
  const links = new FakeCollection();
  const { client, calls } = fakeClient(clientOpts);
  const audits: string[] = [];
  const notes: unknown[] = [];
  const deps: PublishDeps = {
    links: asCollection<Collection<GithubLink>>(links),
    client,
    now: () => NOW,
    sleep: async () => {},
    audit: async (a) => {
      audits.push(a.action);
    },
    notify: async (n) => {
      notes.push(n);
    },
    hubUrl: null,
  };
  const input = (over: Partial<PublishInput> = {}): PublishInput => ({
    orgId: org,
    userId: user,
    actorRole: "dev",
    goalId: "l2-1",
    repo: "espace/devhub",
    target: target(),
    ...over,
  });
  return { links, calls, audits, notes, deps, input };
}

test("publishing twice creates each issue once and reports the second run as skipped", async () => {
  const h = harness();
  const first = await publishGoalToGithub(h.deps, h.input());
  assert.equal(first.created, 3);
  assert.equal(first.skipped, 0);
  assert.equal(first.links.length, 3);
  assert.ok(first.links.every((l) => l.status === "linked" && l.issueNumber));
  assert.deepEqual(first.links.map((l) => l.periodKey), ["2026-01", "2026-02", "2026-03"]);

  const second = await publishGoalToGithub(h.deps, h.input());
  assert.equal(second.created, 0);
  assert.equal(second.skipped, 3);
  assert.equal(h.calls.filter((c) => c.op === "createIssue").length, 3);
  assert.equal(h.audits.filter((a) => a === "github_links.publish").length, 3);
  // The marker names the period so a crash can be recovered later.
  const created = h.calls.find((c) => c.op === "createIssue");
  assert.ok(created);
});

test("periodIndexes narrows the run and the espace labels are ensured once", async () => {
  const h = harness();
  const out = await publishGoalToGithub(h.deps, h.input({ periodIndexes: [1] }));
  assert.equal(out.created, 1);
  assert.equal(out.links.length, 1);
  assert.equal(out.links[0]?.periodIndex, 1);
  assert.deepEqual(
    h.calls.filter((c) => c.op === "ensureLabel").map((c) => c.args[1]),
    ["espace", "espace:R-1"],
  );
});

test("a fresh pending claim blocks a concurrent publish with 409", async () => {
  const h = harness();
  await h.links.insertOne({
    orgId: org,
    userId: user,
    goalId: "l2-1",
    periodIndex: 0,
    status: "pending",
    claimedAt: new Date(NOW.getTime() - 60_000),
    idempotencyKey: await claimKeyOf(h, 0),
  });
  await assert.rejects(
    publishGoalToGithub(h.deps, h.input({ periodIndexes: [0] })),
    (err: unknown) => err instanceof HttpError && err.code === "github_publish_in_progress",
  );
});

test("a stale pending claim is re-claimed and published", async () => {
  const h = harness();
  const key = await claimKeyOf(h, 0);
  await h.links.insertOne({
    orgId: org,
    userId: user,
    goalId: "l2-1",
    periodIndex: 0,
    status: "pending",
    claimedAt: new Date(NOW.getTime() - PENDING_CLAIM_TTL_MS - 1),
    idempotencyKey: key,
    repo: "espace/devhub",
  });
  const out = await publishGoalToGithub(h.deps, h.input({ periodIndexes: [0] }));
  assert.equal(out.created, 1);
  assert.equal(h.links.docs.length, 1);
  assert.equal(h.links.docs[0]?.status, "linked");
});

test("crash recovery: an issue that already carries the marker is adopted, not recreated", async () => {
  const marker = buildMarker({
    orgId: org.toHexString(),
    userId: user.toHexString(),
    goalId: "l2-1",
    periodIndex: 1,
    periodKey: "2026-02",
  });
  const h = harness({
    existing: [
      {
        id: 7,
        node_id: "I_7",
        number: 42,
        html_url: "https://github.com/espace/devhub/issues/42",
        title: "old",
        body: `## Deliverables\n\n- [ ] x\n\n${marker}`,
        state: "open",
      },
    ],
  });
  const out = await publishGoalToGithub(h.deps, h.input());
  assert.equal(out.adopted, 1);
  assert.equal(out.created, 2);
  const feb = out.links.find((l) => l.periodIndex === 1);
  assert.equal(feb?.issueNumber, 42);
  assert.equal(feb?.status, "linked");
  assert.equal(feb?.stale, false);
  assert.equal(h.calls.filter((c) => c.op === "createIssue").length, 2);
  assert.ok(h.audits.includes("github_links.adopt"));
});

test("a rate limit mid-batch stops the run and reports the remainder", async () => {
  const h = harness({
    failOn: {
      call: 2,
      error: new HttpError(429, "rate_limited", "slow down", undefined, 90_000),
    },
  });
  const out = await publishGoalToGithub(h.deps, h.input());
  assert.equal(out.created, 1);
  assert.equal(out.remaining, 2);
  assert.equal(out.retryAfterMs, 90_000);
  const statuses = out.links.map((l) => [l.periodIndex, l.status, l.lastSyncError]);
  assert.deepEqual(statuses, [
    [0, "linked", null],
    [1, "failed", "rate_limited"],
    [2, "failed", "rate_limited"],
  ]);

  // The failed rows are re-claimable at once on retry.
  const retry = await publishGoalToGithub(h.deps, h.input());
  assert.equal(retry.created, 2);
  assert.equal(retry.skipped, 1);
  assert.ok(retry.links.every((l) => l.status === "linked"));
});

test("a token rejection marks the row failed and throws", async () => {
  const h = harness({
    failOn: {
      call: 1,
      error: new HttpError(401, "integration_needs_reconnect", "reconnect"),
    },
  });
  let marked = 0;
  h.deps.markError = async () => {
    marked += 1;
  };
  await assert.rejects(
    publishGoalToGithub(h.deps, h.input()),
    (err: unknown) => err instanceof HttpError && err.code === "integration_needs_reconnect",
  );
  assert.equal(marked, 1);
  assert.ok(h.links.docs.every((d) => d.status === "failed"));
});

test("an unapproved tracker is refused with 400", async () => {
  const h = harness();
  const pending = { ...spec, approval: { status: "pending" } };
  await assert.rejects(
    publishGoalToGithub(h.deps, h.input({ target: target({ spec: pending }) })),
    (err: unknown) =>
      err instanceof HttpError &&
      err.status === 400 &&
      err.code === "github_not_publishable" &&
      /approved/.test(err.message),
  );
  assert.equal(h.calls.length, 0);
});

test("a non-COMPOSED spec is refused with 400", async () => {
  const h = harness();
  const counter = { widget: "COUNTER", composed: null };
  await assert.rejects(
    publishGoalToGithub(h.deps, h.input({ target: target({ spec: counter }) })),
    (err: unknown) =>
      err instanceof HttpError && err.status === 400 && err.code === "github_not_publishable",
  );
});

test("a shared goal notifies its creator once per publish", async () => {
  const h = harness();
  const creator = new ObjectId();
  const asg = new ObjectId();
  const out = await publishGoalToGithub(
    h.deps,
    h.input({
      goalId: `asg_${asg.toHexString()}`,
      target: target({ assignedGoalId: asg, creatorId: creator, specRevision: 2 }),
    }),
  );
  assert.equal(out.created, 3);
  assert.equal(h.notes.length, 1);
  const note = h.notes[0] as { userId: ObjectId; kind: string; data: { count: number } };
  assert.ok(note.userId.equals(creator));
  assert.equal(note.kind, "github_issues_published");
  assert.equal(note.data.count, 3);
  assert.ok(out.links.every((l) => l.specRevision === 2 && l.assignedGoalId?.equals(asg)));
});

test("an asg_ target stamps its specRevision on every row, including a re-claimed failed one", async () => {
  const h = harness();
  const asg = new ObjectId();
  const goalId = `asg_${asg.toHexString()}`;
  // A row that failed under an older plan revision.
  await h.links.insertOne({
    orgId: org,
    userId: user,
    goalId,
    assignedGoalId: asg,
    periodIndex: 0,
    status: "failed",
    claimedAt: new Date(NOW.getTime() - 60_000),
    idempotencyKey: idempotencyKey(org, user, goalId, 0),
    repo: "acme/app",
    specRevision: 1,
  });
  const out = await publishGoalToGithub(
    h.deps,
    h.input({
      goalId,
      repo: "acme/app",
      target: target({ assignedGoalId: asg, creatorId: new ObjectId(), specRevision: 4, defaultRepo: "acme/app" }),
    }),
  );
  assert.equal(out.created, 3);
  assert.deepEqual(out.links.map((l) => l.specRevision), [4, 4, 4]);
});

/** The claim key the flow computes for a period. */
async function claimKeyOf(h: ReturnType<typeof harness>, periodIndex: number): Promise<string> {
  const i = h.input();
  return idempotencyKey(i.orgId, i.userId, i.goalId, periodIndex);
}
