/**
 * buildCorrelation — pure, fixture-driven. Every flag, plus the evidence
 * sources that suppress closed_no_evidence (text, an uploaded file, a
 * merged or starred linked PR), the not_planned exemption and the
 * "nothing published yet" guard on evidence_no_issue.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import type { GithubLinkState } from "../../db/types.js";
import {
  buildCorrelation,
  hasEvidenceText,
  type BuildCorrelationArgs,
  type CorrelationLink,
} from "./correlation.js";

const NOW = new Date("2026-02-10T12:00:00Z");

// Jan (due 25 Jan) · Feb · Mar — monthly keys "2026-01" … "2026-03".
const spec: Record<string, unknown> = {
  widget: "COMPOSED",
  fields: [{ id: "done", kind: "checkbox", label: "Done" }],
  composed: {
    cadence: "monthly",
    cycleStart: "2026-01-01",
    cycleEnd: "2026-03-31",
    periods: [{ label: "January", dueAt: "2026-01-25" }, { label: "February" }, { label: "March" }],
  },
};

function state(over: Partial<GithubLinkState> = {}): GithubLinkState {
  return {
    issueState: "open",
    stateReason: null,
    closedAt: null,
    updatedAt: null,
    title: "",
    tasks: { done: 0, total: 0 },
    labels: [],
    assignees: [],
    commentsCount: 0,
    linkedPrs: [],
    comments: [],
    ...over,
  };
}

function link(periodIndex: number, over: Partial<CorrelationLink> = {}): CorrelationLink {
  return {
    _id: new ObjectId(),
    goalId: "g1",
    periodIndex,
    periodKey: `2026-0${periodIndex + 1}`,
    periodLabel: ["January", "February", "March"][periodIndex] ?? "P",
    repo: "acme/app",
    issueNumber: 10 + periodIndex,
    issueUrl: `https://github.com/acme/app/issues/${10 + periodIndex}`,
    status: "linked",
    state: state(),
    stale: false,
    lastSyncedAt: NOW,
    ...over,
  };
}

const closed = (over: Partial<GithubLinkState> = {}) =>
  state({
    issueState: "closed",
    stateReason: "completed",
    closedAt: new Date("2026-01-20T10:00:00Z"),
    ...over,
  });

function run(over: Partial<BuildCorrelationArgs> = {}) {
  return buildCorrelation({
    goals: [{ goalId: "g1", title: "Ship it", code: "R-1", spec }],
    links: [],
    inputs: [],
    managerVerdicts: [],
    aiVerdicts: [],
    evidenceIds: [],
    evidenceFileCounts: {},
    now: NOW,
    ...over,
  });
}

const period = (out: ReturnType<typeof run>, i: number) => {
  const p = out[0]?.periods.find((x) => x.periodIndex === i);
  assert.ok(p, `period ${i} present`);
  return p;
};

test("goals without a live link are left out; periods follow the plan grid", () => {
  assert.deepEqual(run(), []);
  assert.deepEqual(run({ links: [link(0, { status: "unlinked" })] }), []);
  const out = run({ links: [link(0)] });
  assert.equal(out.length, 1);
  assert.deepEqual(
    out[0]!.periods.map((p) => [p.periodIndex, p.label]),
    [
      [0, "January"],
      [1, "February"],
      [2, "March"],
    ],
  );
  assert.equal(period(out, 0).deadline, "2026-01-25T00:00:00.000Z");
  assert.equal(period(out, 1).deadline, "2026-02-28T00:00:00.000Z");
  assert.equal(period(out, 1).issue, null);
});

test("closed as completed with nothing logged → closed_no_evidence", () => {
  const out = run({ links: [link(0, { state: closed() })] });
  const p = period(out, 0);
  assert.deepEqual(p.flags, ["closed_no_evidence"]);
  assert.equal(p.issue?.state, "closed");
  assert.equal(p.issue?.number, 10);
});

test("evidence text on the period's record suppresses closed_no_evidence", () => {
  const out = run({
    links: [link(0, { state: closed() })],
    inputs: [
      {
        goalId: "g1",
        ts: new Date("2026-01-10T00:00:00Z"),
        createdAt: new Date("2026-01-10T00:00:00Z"),
        value: { periodKey: "2026-01", values: { done: true }, evidence: { done: "https://doc" } },
        source: "manual",
      },
    ],
  });
  assert.deepEqual(period(out, 0).flags, []);
  assert.deepEqual(period(out, 0).reading, { at: "2026-01-10T00:00:00.000Z", source: "manual" });
});

test("a merged linked PR counts as evidence", () => {
  const pr = {
    repo: "acme/app",
    number: 5,
    prId: 999,
    url: "https://github.com/acme/app/pull/5",
    title: "Do it",
    state: "merged" as const,
    mergedAt: new Date("2026-01-19T00:00:00Z"),
    author: "dev",
  };
  const out = run({ links: [link(0, { state: closed({ linkedPrs: [pr] }) })] });
  assert.deepEqual(period(out, 0).flags, []);
  assert.equal(period(out, 0).linkedPrs.length, 1);
  assert.equal(period(out, 0).linkedPrs[0]!.mergedAt, "2026-01-19T00:00:00.000Z");

  // An open PR alone is not evidence — unless it was starred as proof.
  const open = { ...pr, state: "open" as const, mergedAt: null };
  const noProof = run({ links: [link(0, { state: closed({ linkedPrs: [open] }) })] });
  assert.deepEqual(period(noProof, 0).flags, ["closed_no_evidence"]);
  const starred = run({
    links: [link(0, { state: closed({ linkedPrs: [open] }) })],
    evidenceIds: ["mr-gh-999"],
  });
  assert.deepEqual(period(starred, 0).flags, []);
});

test("an uploaded file for the period counts as evidence (nested keys too)", () => {
  const out = run({
    links: [link(0, { state: closed() })],
    evidenceFileCounts: { g1: { "2026-01": 1 } },
  });
  assert.deepEqual(period(out, 0).flags, []);
  const nested = run({
    links: [link(0, { state: closed() })],
    evidenceFileCounts: { g1: { "2026-01::2026-W2": 2 } },
  });
  assert.deepEqual(period(nested, 0).flags, []);
  const otherPeriod = run({
    links: [link(0, { state: closed() })],
    evidenceFileCounts: { g1: { "2026-02": 1 } },
  });
  assert.deepEqual(period(otherPeriod, 0).flags, ["closed_no_evidence"]);
});

test("closed as not planned is never closed_no_evidence", () => {
  const out = run({ links: [link(0, { state: closed({ stateReason: "not_planned" }) })] });
  assert.deepEqual(period(out, 0).flags, []);
});

test("an entry on an unlinked period → evidence_no_issue, once something is published", () => {
  const entry = {
    goalId: "g1",
    ts: new Date("2026-02-03T00:00:00Z"),
    createdAt: new Date("2026-02-03T09:00:00Z"),
    value: { periodKey: "2026-02", values: { done: true } },
    source: "manual",
  };
  const out = run({ links: [link(0)], inputs: [entry] });
  assert.deepEqual(period(out, 1).flags, ["evidence_no_issue"]);

  // A file alone is enough too.
  const files = run({ links: [link(0)], evidenceFileCounts: { g1: { "2026-03": 1 } } });
  assert.deepEqual(period(files, 2).flags, ["evidence_no_issue"]);
});

test("an unpublished goal (only pending / failed links) yields no evidence_no_issue", () => {
  const entry = {
    goalId: "g1",
    ts: new Date("2026-02-03T00:00:00Z"),
    value: { periodKey: "2026-02", values: { done: true } },
    source: "manual",
  };
  const out = run({
    links: [link(0, { status: "failed", issueNumber: null, issueUrl: null, state: null })],
    inputs: [entry],
  });
  assert.deepEqual(period(out, 1).flags, []);
  assert.equal(period(out, 0).issue?.linkStatus, "failed");
});

test("open after the due day → open_past_deadline; open before it → nothing", () => {
  const out = run({ links: [link(0), link(1)] });
  assert.deepEqual(period(out, 0).flags, ["open_past_deadline"]);
  assert.deepEqual(period(out, 1).flags, []);
});

test("stale_period and issue_missing come straight from the link", () => {
  const out = run({
    links: [
      link(1, { stale: true }),
      link(2, { state: state({ issueState: "missing" }) }),
    ],
  });
  assert.deepEqual(period(out, 1).flags, ["stale_period"]);
  assert.deepEqual(period(out, 2).flags, ["issue_missing"]);
});

test("grade: manager outranks AI, matched by the period's key", () => {
  const out = run({
    links: [link(0)],
    managerVerdicts: [
      { goalId: "g1", periodKey: "2026-01", tier: "over_achieved", gradedAt: NOW },
      { goalId: "g1", periodKey: "2026", tier: "achieved", gradedAt: NOW },
    ],
    aiVerdicts: [
      { goalId: "g1", periodKey: "2026-01", tier: "not_achieved", gradedAt: NOW },
      { goalId: "g1", periodKey: "2026-02", tier: "achieved", gradedAt: NOW },
    ],
  });
  assert.deepEqual(period(out, 0).grade, { tier: "over_achieved", by: "manager" });
  assert.deepEqual(period(out, 1).grade, { tier: "achieved", by: "ai" });
  assert.equal(period(out, 2).grade, null);
});

test("the reading is the newest entry in the period, by save time", () => {
  const out = run({
    links: [link(0, { state: closed() })],
    inputs: [
      {
        goalId: "g1",
        ts: new Date("2026-01-05T00:00:00Z"),
        createdAt: new Date("2026-01-05T00:00:00Z"),
        value: { periodKey: "2026-01" },
        source: "manual",
      },
      {
        goalId: "g1",
        ts: new Date("2026-01-20T10:00:00Z"),
        createdAt: new Date("2026-01-20T10:00:00Z"),
        value: { periodKey: "2026-01", github: { issueNumber: 10 } },
        source: "github",
      },
      // mgmt track never counts as the owner's own record.
      {
        goalId: "g1",
        ts: new Date("2026-01-28T00:00:00Z"),
        createdAt: new Date("2026-01-28T00:00:00Z"),
        value: { periodKey: "mgmt::2026-01" },
        source: "manual",
      },
    ],
  });
  assert.deepEqual(period(out, 0).reading, { at: "2026-01-20T10:00:00.000Z", source: "github" });
  // The GitHub reading itself is not evidence.
  assert.deepEqual(period(out, 0).flags, ["closed_no_evidence"]);
});

test("a linked index past the plan's grid is kept, from the link itself", () => {
  const out = run({ links: [link(5, { periodKey: "2026-06", periodLabel: "June", stale: true })] });
  const p = period(out, 5);
  assert.equal(p.label, "June");
  assert.equal(p.deadline, null);
  assert.deepEqual(p.flags, ["stale_period"]);
});

test("hasEvidenceText ignores blanks", () => {
  assert.equal(hasEvidenceText({ value: { evidence: { a: "  " } } }), false);
  assert.equal(hasEvidenceText({ value: { evidence: { a: "x" } } }), true);
  assert.equal(hasEvidenceText({ value: null }), false);
});
