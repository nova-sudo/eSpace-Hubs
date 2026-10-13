/**
 * sync.ts — the pure reducers and the one-link flow against in-memory
 * collections and a scripted client. The property that matters most: a
 * close writes exactly ONE goal_inputs row, timestamped at the close,
 * carrying the period's latest values forward.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId, type Collection } from "mongodb";
import type { GithubLink, GoalInputEntry } from "../../db/types.js";
import { asCollection, FakeCollection } from "../../lib/fake-collection.test-support.js";
import { HttpError } from "../../middleware/error-handler.js";
import type { GithubClient, GithubIssue } from "./github-client.js";
import { buildCommentMarker } from "@espace-devhub/shared/github-links";
import {
  closingRefCandidates,
  MAX_LINKED_PRS,
  reduceComments,
  reduceIssue,
  reducePull,
  reduceTimelinePrRefs,
  shouldWriteReading,
  syncLink,
  type SyncDeps,
} from "./sync.js";

const org = new ObjectId();
const user = new ObjectId();
const NOW = new Date("2026-02-10T12:00:00Z");

const closedIssue: GithubIssue = {
  id: 9001,
  node_id: "I_kw",
  number: 42,
  html_url: "https://github.com/espace/devhub/issues/42",
  title: "[R-1] January — Ship the thing",
  body: "## Deliverables\n\n- [x] Plan\n- [ ] Build\n- [x] Demo\n",
  state: "closed",
  state_reason: "completed",
  closed_at: "2026-01-26T09:30:00Z",
  updated_at: "2026-01-26T09:31:00Z",
  labels: [{ name: "espace" }, { name: "espace:R-1" }, "bug"],
  assignees: [{ login: "octocat" }],
  comments: 3,
};

function link(over: Partial<GithubLink> = {}): GithubLink {
  return {
    _id: new ObjectId(),
    orgId: org,
    userId: user,
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
    createdBy: user,
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

test("reduceIssue mirrors the GitHub payload", () => {
  const state = reduceIssue(closedIssue);
  assert.equal(state.issueState, "closed");
  assert.equal(state.stateReason, "completed");
  assert.equal(state.closedAt?.toISOString(), "2026-01-26T09:30:00.000Z");
  assert.equal(state.updatedAt?.toISOString(), "2026-01-26T09:31:00.000Z");
  assert.equal(state.title, closedIssue.title);
  assert.deepEqual(state.tasks, { done: 2, total: 3 });
  assert.deepEqual(state.labels, ["espace", "espace:R-1", "bug"]);
  assert.deepEqual(state.assignees, ["octocat"]);
  assert.equal(state.commentsCount, 3);
  assert.deepEqual(state.linkedPrs, []);
  assert.deepEqual(state.comments, []);
});

test("reduceIssue tolerates a sparse payload", () => {
  const state = reduceIssue({ ...closedIssue, state: "open", body: null, labels: undefined, assignees: undefined, comments: undefined, closed_at: null, state_reason: null });
  assert.equal(state.issueState, "open");
  assert.equal(state.closedAt, null);
  assert.deepEqual(state.tasks, { done: 0, total: 0 });
  assert.equal(state.commentsCount, 0);
});

test("shouldWriteReading: closed-as-completed once, never not_planned, never open", () => {
  const fresh = { readingInputId: null };
  assert.equal(shouldWriteReading(fresh, { issueState: "closed", stateReason: "completed" }), true);
  assert.equal(shouldWriteReading(fresh, { issueState: "closed", stateReason: null }), true);
  assert.equal(shouldWriteReading(fresh, { issueState: "closed", stateReason: "not_planned" }), false);
  assert.equal(shouldWriteReading({ readingInputId: new ObjectId() }, { issueState: "closed", stateReason: "completed" }), false);
  assert.equal(shouldWriteReading(fresh, { issueState: "open", stateReason: null }), false);
  assert.equal(shouldWriteReading(fresh, { issueState: "missing", stateReason: null }), false);
});

function harness(script: () => Promise<GithubIssue>) {
  const links = new FakeCollection();
  const inputs = new FakeCollection();
  const audits: string[] = [];
  const notes: Array<{ userId: ObjectId; kind: string }> = [];
  let marked = 0;
  const client = {
    getIssue: async () => script(),
  } as unknown as GithubClient;
  const deps: SyncDeps = {
    links: asCollection<Collection<GithubLink>>(links),
    inputs: asCollection<Collection<GoalInputEntry>>(inputs),
    client,
    now: () => NOW,
    audit: async (a) => {
      audits.push(a.action);
    },
    notify: async (n) => {
      notes.push({ userId: n.userId, kind: n.kind });
    },
    markError: async () => {
      marked += 1;
    },
    recipients: async () => [{ userId: new ObjectId(), kind: "github_issue_closed" }],
    ownerName: async () => "Dana",
  };
  return { links, inputs, audits, notes, deps, marked: () => marked };
}

test("a completed close writes ONE reading at the close time, carrying values forward", async () => {
  const h = harness(async () => closedIssue);
  const row = link();
  h.links.docs.push({ ...row });
  // The period's half-filled form, submitted before the close.
  await h.inputs.insertOne({
    orgId: org,
    userId: user,
    goalId: "l2-1",
    ts: new Date("2026-01-20T10:00:00Z"),
    createdAt: new Date("2026-01-20T10:00:00Z"),
    value: { periodKey: "2026-01", values: { done: false, notes: "wip" } },
    note: null,
    source: "manual",
  });
  // A different period's entry must not be carried.
  await h.inputs.insertOne({
    orgId: org,
    userId: user,
    goalId: "l2-1",
    ts: new Date("2026-02-01T10:00:00Z"),
    createdAt: new Date("2026-02-01T10:00:00Z"),
    value: { periodKey: "2026-02", values: { notes: "other" } },
    note: null,
    source: "manual",
  });

  const first = await syncLink(h.deps, row);
  assert.equal(first.readingWritten, true);
  assert.equal(first.error, undefined);
  assert.equal(first.link.state?.issueState, "closed");
  assert.ok(first.link.readingInputId instanceof ObjectId);
  assert.equal(first.link.readingClosedAt?.toISOString(), "2026-01-26T09:30:00.000Z");

  const written = h.inputs.docs.filter((d) => d.source === "github");
  assert.equal(written.length, 1);
  const reading = written[0] as GoalInputEntry & { value: Record<string, unknown> };
  assert.equal(reading.ts.toISOString(), "2026-01-26T09:30:00.000Z");
  assert.equal(reading.createdAt?.toISOString(), "2026-01-26T09:30:00.000Z");
  assert.equal(reading.goalId, "l2-1");
  assert.equal(reading.value.periodKey, "2026-01");
  assert.deepEqual(reading.value.values, { done: false, notes: "wip" });
  assert.deepEqual(reading.value.github, {
    issueNumber: 42,
    repo: "espace/devhub",
    closedAt: "2026-01-26T09:30:00.000Z",
    url: "https://github.com/espace/devhub/issues/42",
  });
  assert.equal(reading.note, "Closed on GitHub: https://github.com/espace/devhub/issues/42");
  assert.ok(reading._id.equals(first.link.readingInputId as ObjectId));

  const stored = h.links.docs[0] as GithubLink;
  assert.equal(stored.lastSyncedAt?.getTime(), NOW.getTime());
  assert.equal(stored.lastSyncError, null);
  assert.equal(stored.syncFailures, 0);
  assert.ok(stored.readingInputId);
  assert.deepEqual(h.audits, ["github_links.reading"]);
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0]?.kind, "github_issue_closed");

  // Second sync: the state is refreshed, nothing else is written.
  const second = await syncLink(h.deps, stored);
  assert.equal(second.readingWritten, false);
  assert.equal(h.inputs.docs.filter((d) => d.source === "github").length, 1);
  assert.equal(h.audits.length, 1);
  assert.equal(h.notes.length, 1);
});

test("a single-window plan (periodKey null) writes a reading without a periodKey", async () => {
  const h = harness(async () => closedIssue);
  const row = link({ periodKey: null });
  h.links.docs.push({ ...row });
  const out = await syncLink(h.deps, row);
  assert.equal(out.readingWritten, true);
  const reading = h.inputs.docs[0] as { value: Record<string, unknown> };
  assert.equal("periodKey" in reading.value, false);
});

test("not_planned is mirrored but never logged as done", async () => {
  const h = harness(async () => ({ ...closedIssue, state_reason: "not_planned" }));
  const row = link();
  h.links.docs.push({ ...row });
  const out = await syncLink(h.deps, row);
  assert.equal(out.readingWritten, false);
  assert.equal(out.link.state?.stateReason, "not_planned");
  assert.equal(h.inputs.docs.length, 0);
});

test("a 404 marks the issue missing without counting as a failure", async () => {
  const h = harness(async () => {
    throw new HttpError(404, "github_target_missing", "gone");
  });
  const row = link({ state: reduceIssue({ ...closedIssue, state: "open" }) });
  h.links.docs.push({ ...row });
  const out = await syncLink(h.deps, row);
  assert.equal(out.error, undefined);
  assert.equal(out.link.state?.issueState, "missing");
  assert.equal(out.link.state?.title, closedIssue.title);
  const stored = h.links.docs[0] as GithubLink;
  assert.equal(stored.state?.issueState, "missing");
  assert.equal(stored.syncFailures, 0);
  assert.equal(stored.lastSyncError, null);
  assert.equal(h.inputs.docs.length, 0);
});

test("a token rejection records integration_needs_reconnect and flags the integration", async () => {
  const h = harness(async () => {
    throw new HttpError(401, "integration_needs_reconnect", "reconnect");
  });
  const row = link({ syncFailures: 1 });
  h.links.docs.push({ ...row });
  const out = await syncLink(h.deps, row);
  assert.equal(out.error?.code, "integration_needs_reconnect");
  const stored = h.links.docs[0] as GithubLink;
  assert.equal(stored.lastSyncError, "integration_needs_reconnect");
  assert.equal(stored.syncFailures, 2);
  assert.equal(h.marked(), 1);
});

test("a rate limit records the reason and rethrows so the batch stops", async () => {
  const h = harness(async () => {
    throw new HttpError(429, "rate_limited", "slow", undefined, 60_000);
  });
  const row = link();
  h.links.docs.push({ ...row });
  await assert.rejects(syncLink(h.deps, row), (err: unknown) => err instanceof HttpError && err.status === 429);
  const stored = h.links.docs[0] as GithubLink;
  assert.equal(stored.lastSyncError, "rate_limited");
  assert.equal(stored.syncFailures, 0);
});

// ─── Phase 3: linked PRs + comments ──────────────────────────────────

const xref = (repo: string, number: number, extra: Record<string, unknown> = {}) => ({
  event: "cross-referenced",
  source: {
    type: "issue",
    issue: {
      id: number * 1000,
      number,
      html_url: `https://github.com/${repo}/pull/${number}`,
      pull_request: { url: "x" },
      repository: { full_name: repo },
      ...extra,
    },
  },
});

test("reduceTimelinePrRefs: PRs from cross-referenced + connected, deduped, cross-repo kept", () => {
  const refs = reduceTimelinePrRefs(
    [
      xref("espace/devhub", 7),
      { event: "labeled", label: { name: "x" } },
      // A cross-reference from a plain issue is not a PR.
      { event: "cross-referenced", source: { issue: { number: 8, repository: { full_name: "espace/devhub" } } } },
      xref("espace/devhub", 7), // same PR referenced twice
      xref("Other/Lib", 3),
      { event: "connected", source: { issue: { number: 9, pull_request: {}, html_url: "https://github.com/espace/devhub/pull/9" } } },
      { event: "connected", actor: { login: "a" } }, // no subject — skipped
      null,
    ],
    { repo: "espace/devhub" },
  );
  assert.deepEqual(refs, [
    { repo: "espace/devhub", number: 7 },
    { repo: "other/lib", number: 3 },
    { repo: "espace/devhub", number: 9 },
  ]);
  assert.deepEqual(reduceTimelinePrRefs(undefined, { repo: "a/b" }), []);
});

test("closingRefCandidates: same repo only, never the issue itself", () => {
  const refs = closingRefCandidates(
    ["Fixes #12 and closes other/repo#4", "resolves #42", null, "fixes #12"],
    { repo: "espace/devhub", issueNumber: 42 },
  );
  assert.deepEqual(refs, [{ repo: "espace/devhub", number: 12 }]);
});

test("reducePull: merged beats closed, plain issues are dropped", () => {
  const merged = reducePull(
    {
      id: 555,
      number: 7,
      title: "Ship it",
      state: "closed",
      html_url: "https://github.com/espace/devhub/pull/7",
      user: { login: "dev" },
      pull_request: { merged_at: "2026-01-20T10:00:00Z", html_url: "https://github.com/espace/devhub/pull/7" },
    },
    "espace/devhub",
  );
  assert.equal(merged?.state, "merged");
  assert.equal(merged?.prId, 555);
  assert.equal(merged?.author, "dev");
  assert.equal(merged?.mergedAt?.toISOString(), "2026-01-20T10:00:00.000Z");
  const closed = reducePull({ id: 1, number: 2, state: "closed", pull_request: { merged_at: null } }, "a/b");
  assert.equal(closed?.state, "closed");
  assert.equal(closed?.author, null);
  assert.equal(reducePull({ id: 1, number: 2, state: "open" }, "a/b"), null);
});

test("reduceComments: drops eSpace's own posts and bots, keeps the newest 20 oldest-first, truncates", () => {
  const raw = [];
  for (let i = 1; i <= 25; i += 1) {
    raw.push({
      id: i,
      user: { login: `dev${i}`, type: "User" },
      body: i === 25 ? "x".repeat(3000) : `reply ${i}`,
      created_at: new Date(Date.UTC(2026, 0, i)).toISOString(),
      html_url: `https://github.com/espace/devhub/issues/42#issuecomment-${i}`,
    });
  }
  raw.push({ id: 100, user: { login: "mgr", type: "User" }, body: `Good work\n\n${buildCommentMarker("manager_note", "a".repeat(24))}`, created_at: "2026-02-01T00:00:00Z", html_url: "u" });
  raw.push({ id: 101, user: { login: "ci[bot]", type: "Bot" }, body: "build passed", created_at: "2026-02-02T00:00:00Z", html_url: "u" });
  raw.push({ id: 102, user: null, body: "ghost", created_at: "2026-02-03T00:00:00Z" });
  const out = reduceComments(raw);
  assert.equal(out.length, 20);
  assert.equal(out[0]?.commentId, 6);
  assert.equal(out[19]?.commentId, 25);
  assert.equal(out[19]?.body.length, 2000);
  assert.ok(out.every((c) => c.author !== "mgr" && c.author !== "ci[bot]"));
  assert.equal(out[0]?.author, "dev6");
  assert.ok(out[0]?.createdAt instanceof Date);
});

function extrasHarness(opts: {
  timeline?: () => Promise<unknown[]>;
  comments?: () => Promise<unknown[]>;
  issueFor?: (repo: string, n: number) => Promise<GithubIssue>;
}) {
  const links = new FakeCollection();
  const inputs = new FakeCollection();
  const getIssueCalls: string[] = [];
  const client = {
    getIssue: async (repo: string, n: number) => {
      getIssueCalls.push(`${repo}#${n}`);
      if (repo === "espace/devhub" && n === 42) return { ...closedIssue, state: "open", body: "Plan.\n\nFixes #12", comments: 2 };
      if (opts.issueFor) return opts.issueFor(repo, n);
      return {
        id: n * 1000,
        node_id: "x",
        number: n,
        html_url: `https://github.com/${repo}/pull/${n}`,
        title: `PR ${n}`,
        body: "",
        state: "closed",
        pull_request: { merged_at: "2026-01-20T10:00:00Z" },
        user: { login: "dev" },
      } as unknown as GithubIssue;
    },
    listTimeline: opts.timeline ?? (async () => []),
    listComments: opts.comments ?? (async () => []),
  } as unknown as GithubClient;
  const deps: SyncDeps = {
    links: asCollection<Collection<GithubLink>>(links),
    inputs: asCollection<Collection<GoalInputEntry>>(inputs),
    client,
    now: () => NOW,
    audit: async () => {},
    notify: async () => {},
    sleep: async () => {},
  };
  return { links, deps, getIssueCalls };
}

test("syncLink mirrors linked PRs (timeline + closing refs, deduped by prId, cross-repo kept, 404 skipped)", async () => {
  const h = extrasHarness({
    timeline: async () => [xref("espace/devhub", 7), xref("espace/devhub", 7), xref("other/lib", 3), xref("other/gone", 5)],
    comments: async () => [
      { id: 1, user: { login: "dev", type: "User" }, body: "Also closes #7 and #13", created_at: "2026-01-21T00:00:00Z", html_url: "u1" },
    ],
    issueFor: async (repo, n) => {
      if (repo === "other/gone") throw new HttpError(404, "github_target_missing", "gone");
      if (n === 13) return { id: 13, node_id: "i", number: 13, html_url: "x", title: "an issue", body: "", state: "open" };
      return {
        id: n * 1000, node_id: "x", number: n, html_url: `https://github.com/${repo}/pull/${n}`, title: `PR ${n}`, body: "",
        state: "open", pull_request: { merged_at: null }, user: { login: "dev" },
      } as unknown as GithubIssue;
    },
  });
  const row = link();
  h.links.docs.push({ ...row });
  const out = await syncLink(h.deps, row);
  const prs = out.link.state?.linkedPrs ?? [];
  assert.deepEqual(prs.map((p) => `${p.repo}#${p.number}`), ["espace/devhub#7", "other/lib#3", "espace/devhub#12"]);
  assert.equal(prs[0]?.prId, 7000);
  assert.equal(prs[0]?.state, "open");
  assert.equal(out.link.state?.comments.length, 1);
  const stored = h.links.docs[0] as GithubLink;
  assert.equal(stored.state?.linkedPrs.length, 3);
  // #7 hydrated once even though it appears three times.
  assert.equal(h.getIssueCalls.filter((c) => c === "espace/devhub#7").length, 1);
});

test("syncLink caps linked PRs at 10", async () => {
  const h = extrasHarness({
    timeline: async () => Array.from({ length: 15 }, (_, i) => xref("espace/devhub", 100 + i)),
  });
  const row = link();
  h.links.docs.push({ ...row });
  const out = await syncLink(h.deps, row);
  assert.equal(out.link.state?.linkedPrs.length, MAX_LINKED_PRS);
});

test("a failed timeline / comments read keeps the previous arrays and still updates the state", async () => {
  const previous = {
    ...reduceIssue({ ...closedIssue, state: "open" }),
    linkedPrs: [{ repo: "espace/devhub", number: 7, prId: 7000, url: "u", title: "PR 7", state: "open" as const, mergedAt: null, author: "dev" }],
    comments: [{ commentId: 1, author: "dev", body: "hi", createdAt: NOW, url: "u" }],
  };
  const h = extrasHarness({
    timeline: async () => {
      throw new HttpError(502, "github_upstream_error", "boom");
    },
    comments: async () => {
      throw new HttpError(429, "rate_limited", "slow");
    },
  });
  const row = link({ state: previous });
  h.links.docs.push({ ...row });
  const out = await syncLink(h.deps, row);
  assert.equal(out.error, undefined);
  assert.equal(out.link.state?.issueState, "open");
  assert.equal(out.link.state?.linkedPrs[0]?.prId, 7000);
  assert.equal(out.link.state?.comments[0]?.body, "hi");
});
