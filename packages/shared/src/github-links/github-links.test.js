import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCommentMarker,
  buildIssueBody,
  buildIssueTitle,
  buildMarker,
  espaceLabel,
  extractClosingRefs,
  parseCommentMarker,
  parseMarker,
  taskListProgress,
} from "./index.js";

const ORG = "6543210fedcba9876543210f";
const USER = "0123456789abcdef01234567";

/**
 * The marker is the ONLY durable link between an issue and a period. If it
 * cannot be rebuilt from an issue body, a crashed publish would leave an
 * orphan issue on GitHub and a duplicate on retry, so round-tripping is the
 * contract here, not a nicety.
 */
test("marker round-trips every field", () => {
  const fields = { orgId: ORG, userId: USER, goalId: "L2-03", periodIndex: 4, periodKey: "2026-W12" };
  const marker = buildMarker(fields);
  assert.match(marker, /^<!-- espace:v1 .* -->$/);
  assert.deepEqual(parseMarker(`intro\n\n${marker}\n`), fields);
});

test("marker renders a null period key as `once` and parses it back to null", () => {
  const marker = buildMarker({ orgId: ORG, userId: USER, goalId: "asg_abc", periodIndex: 0, periodKey: null });
  assert.ok(marker.includes("key=once"));
  assert.equal(parseMarker(marker).periodKey, null);
});

test("marker refuses ids that would not survive the regex", () => {
  assert.throws(() => buildMarker({ orgId: "nope", userId: USER, goalId: "g", periodIndex: 0, periodKey: null }));
  assert.throws(() => buildMarker({ orgId: ORG, userId: USER, goalId: "g -->", periodIndex: 0, periodKey: null }));
  assert.throws(() => buildMarker({ orgId: ORG, userId: USER, goalId: "g", periodIndex: -1, periodKey: null }));
  assert.throws(() => buildMarker({ orgId: ORG, userId: USER, goalId: "g", periodIndex: 1.5, periodKey: null }));
});

test("parseMarker never throws and ignores look-alikes", () => {
  assert.equal(parseMarker(null), null);
  assert.equal(parseMarker(""), null);
  assert.equal(parseMarker("<!-- espace:v2 org=x -->"), null);
  assert.equal(parseMarker(`<!-- espace:v1 org=${ORG} user=${USER} goal=g idx=abc key=once -->`), null);
});

test("espaceLabel sanitises and falls back to the goal id", () => {
  assert.equal(espaceLabel("L2-03"), "espace:L2-03");
  assert.equal(espaceLabel("Ship it / now!"), "espace:Ship-it-now");
  assert.equal(espaceLabel("", "asg_0123456789abcdef"), "espace:asg_01234567");
  assert.equal(espaceLabel("///", ""), "espace:goal");
  assert.ok(espaceLabel("x".repeat(200)).length <= 50);
});

test("comment marker round-trips and rejects unknown kinds", () => {
  const m = buildCommentMarker("tier_verdict", "evt-123");
  assert.deepEqual(parseCommentMarker(`Grade: achieved\n${m}`), { kind: "tier_verdict", sourceId: "evt-123" });
  assert.throws(() => buildCommentMarker("spam", "x"));
  assert.equal(parseCommentMarker("hello"), null);
});

test("issue title orders code, period, title and stays under GitHub's cap", () => {
  assert.equal(
    buildIssueTitle({ goalCode: "L2-03", periodLabel: "Week 3", goalTitle: "AI orientation" }),
    "[L2-03] Week 3 — AI orientation",
  );
  assert.equal(buildIssueTitle({ goalTitle: "Only a title" }), "Only a title");
  assert.ok(buildIssueTitle({ goalCode: "C", periodLabel: "P", goalTitle: "t".repeat(400) }).length <= 256);
});

test("issue body renders deliverables as a task list and ends with the marker", () => {
  const body = buildIssueBody({
    goalTitle: "AI orientation",
    hubUrl: "https://hub.example/dev/goals",
    period: {
      label: "Week 1",
      dueAt: "2026-03-06",
      detail: {
        focus: "Get set up",
        activities: ["Read AGENTS.md", "Pair with a senior"],
        deliverables: [
          { label: "Team norms", format: "AGENTS.md in the repo", criteria: "merged to main" },
          "A plain string deliverable",
        ],
      },
    },
    marker: { orgId: ORG, userId: USER, goalId: "L2-03", periodIndex: 0, periodKey: "2026-W10" },
  });
  const lines = body.split("\n");
  assert.ok(lines.includes("- [ ] Team norms (AGENTS.md in the repo; done when merged to main)"));
  assert.ok(lines.includes("- [ ] A plain string deliverable"));
  assert.ok(lines.includes("- Read AGENTS.md"));
  assert.ok(body.includes("**Due:** 2026-03-06"));
  assert.ok(body.includes("Tracked in eSpace: https://hub.example/dev/goals"));
  assert.match(lines[lines.length - 1], /^<!-- espace:v1 /);
  assert.deepEqual(taskListProgress(body), { done: 0, total: 2 });
});

test("issue body with no deliverables still has one tickable item", () => {
  const body = buildIssueBody({
    period: { label: "Once" },
    marker: { orgId: ORG, userId: USER, goalId: "g", periodIndex: 0, periodKey: null },
  });
  assert.deepEqual(taskListProgress(body), { done: 0, total: 1 });
});

test("issue body keeps every deliverable on one line and drops a non-https hub url", () => {
  const body = buildIssueBody({
    period: { detail: { deliverables: [{ label: "multi\nline\nlabel" }] } },
    hubUrl: "javascript:alert(1)",
    marker: { orgId: ORG, userId: USER, goalId: "g", periodIndex: 0, periodKey: null },
  });
  assert.ok(body.includes("- [ ] multi line label"));
  assert.ok(!body.includes("javascript:"));
});

test("taskListProgress counts ticks, ignores fenced code and non-task bullets", () => {
  const body = [
    "- [ ] one",
    "- [x] two",
    "* [X] three",
    "1. [ ] four",
    "- not a task",
    "- [ ]",
    "```",
    "- [ ] inside a fence",
    "```",
    "  - [x] indented five",
  ].join("\n");
  assert.deepEqual(taskListProgress(body), { done: 3, total: 5 });
  assert.deepEqual(taskListProgress(""), { done: 0, total: 0 });
  assert.deepEqual(taskListProgress(undefined), { done: 0, total: 0 });
});

test("extractClosingRefs reads GitHub's closing grammar and dedupes", () => {
  const text = [
    "Closes #12, fixes #12 and resolves owner/Other#7.",
    "Also closed https://github.com/Acme/Repo/issues/99.",
    "Mentions #5 without a keyword.",
  ].join(" ");
  assert.deepEqual(extractClosingRefs(text, { repo: "Acme/Repo" }), [
    { repo: "acme/repo", number: 12 },
    { repo: "owner/other", number: 7 },
    { repo: "acme/repo", number: 99 },
  ]);
  assert.deepEqual(extractClosingRefs("closes #3"), []);
  assert.deepEqual(extractClosingRefs(null, { repo: "a/b" }), []);
});
