import test from "node:test";
import assert from "node:assert/strict";

import {
  CORRELATION_FLAGS,
  allSyncedWithin,
  chipState,
  collectLinkedPrs,
  correlationChipLink,
  correlationSummary,
  correlationSummaryLine,
  flagCopy,
  prCountLabel,
  readingLabel,
  defaultGradeLink,
  findLink,
  hasPost,
  linkOptionLabel,
  postKindLabel,
  prEvidenceId,
  prEvidenceItem,
  prStateLabel,
  prTone,
  threadItems,
  freshnessLabel,
  isGithubRepoSlug,
  isStale,
  publishErrorCopy,
  retryMinutes,
  summarizeLinks,
} from "./link-model.js";

const NOW = Date.parse("2026-10-13T12:00:00Z");

function link(over = {}) {
  return {
    id: "l1",
    goalId: "g1",
    periodIndex: 0,
    periodKey: "2026-W41",
    periodLabel: "Week 1",
    repo: "acme/app",
    issueNumber: 123,
    issueUrl: "https://github.com/acme/app/issues/123",
    status: "linked",
    state: null,
    lastSyncedAt: new Date(NOW - 5 * 60_000).toISOString(),
    lastSyncError: null,
    syncFailures: 0,
    readingWritten: false,
    stale: false,
    posts: [],
    ...over,
  };
}

test("chipState: null and unlinked → neutral 'Not on GitHub'", () => {
  assert.deepEqual(chipState(null, NOW).tone, "neutral");
  assert.equal(chipState(null, NOW).label, "Not on GitHub");
  assert.equal(chipState(link({ status: "unlinked" }), NOW).label, "Not on GitHub");
});

test("chipState: pending → lemon 'Publishing…'", () => {
  const s = chipState(link({ status: "pending", issueNumber: null }), NOW);
  assert.equal(s.tone, "lemon");
  assert.equal(s.label, "Publishing…");
});

test("chipState: failed → peach 'Publish failed'", () => {
  const s = chipState(link({ status: "failed" }), NOW);
  assert.equal(s.tone, "peach");
  assert.equal(s.label, "Publish failed");
});

test("chipState: needs reconnect → lemon 'Reconnect GitHub' (beats issue state)", () => {
  const s = chipState(
    link({
      lastSyncError: "integration_needs_reconnect",
      state: { issueState: "open", tasks: { done: 1, total: 2 } },
    }),
    NOW,
  );
  assert.equal(s.tone, "lemon");
  assert.equal(s.label, "Reconnect GitHub");
  assert.match(s.title, /acme\/app#123/);
});

test("chipState: missing → peach 'Issue not found'", () => {
  const s = chipState(link({ state: { issueState: "missing" } }), NOW);
  assert.equal(s.tone, "peach");
  assert.equal(s.label, "Issue not found");
});

test("chipState: closed as not_planned → neutral", () => {
  const s = chipState(
    link({ state: { issueState: "closed", stateReason: "not_planned", closedAt: "2026-10-10T09:00:00Z" } }),
    NOW,
  );
  assert.equal(s.tone, "neutral");
  assert.equal(s.label, "Closed · not planned");
});

test("chipState: closed → mint with the short close date", () => {
  const s = chipState(
    link({ state: { issueState: "closed", stateReason: "completed", closedAt: "2026-10-10T09:00:00Z" } }),
    NOW,
  );
  assert.equal(s.tone, "mint");
  assert.match(s.label, /^Closed on GitHub Oct 10$/);
  // No closedAt → no date, still mint.
  const noDate = chipState(link({ state: { issueState: "closed", stateReason: "completed", closedAt: null } }), NOW);
  assert.equal(noDate.label, "Closed on GitHub");
  assert.equal(noDate.tone, "mint");
});

test("chipState: open → sky with task progress, omitted when total is 0", () => {
  const withTasks = chipState(link({ state: { issueState: "open", tasks: { done: 2, total: 5 } } }), NOW);
  assert.equal(withTasks.tone, "sky");
  assert.equal(withTasks.label, "Open on GitHub · 2/5 tasks");
  const noTasks = chipState(link({ state: { issueState: "open", tasks: { done: 0, total: 0 } } }), NOW);
  assert.equal(noTasks.label, "Open on GitHub");
  // Linked but never synced yet (state null) reads as open too.
  const unsynced = chipState(link({ state: null, lastSyncedAt: null }), NOW);
  assert.equal(unsynced.tone, "sky");
  assert.equal(unsynced.label, "Open on GitHub");
  assert.match(unsynced.title, /never synced/);
});

test("isStale mirrors link.stale", () => {
  assert.equal(isStale(link({ stale: true })), true);
  assert.equal(isStale(link({ stale: false })), false);
  assert.equal(isStale(null), false);
});

test("freshnessLabel: relative wording, 'never synced' without a stamp", () => {
  assert.equal(freshnessLabel(link(), NOW), "synced 5 min ago");
  assert.equal(freshnessLabel(link({ lastSyncedAt: null }), NOW), "never synced");
  assert.equal(freshnessLabel(link({ lastSyncedAt: "garbage" }), NOW), "never synced");
});

test("findLink: by positional period index, active link wins over an unlinked one", () => {
  const unlinked = link({ id: "old", periodIndex: 2, status: "unlinked" });
  const active = link({ id: "new", periodIndex: 2 });
  const other = link({ id: "o", periodIndex: 1 });
  assert.equal(findLink([unlinked, active, other], 2)?.id, "new");
  assert.equal(findLink([unlinked, other], 2)?.id, "old");
  assert.equal(findLink([other], 2), null);
  assert.equal(findLink(null, 0), null);
  assert.equal(findLink([other], "1"), null);
});

test("summarizeLinks counts active links by issue state", () => {
  const links = [
    link({ id: "a", periodIndex: 0, state: { issueState: "open" } }),
    link({ id: "b", periodIndex: 1, state: { issueState: "closed" } }),
    link({ id: "c", periodIndex: 2, state: { issueState: "missing" } }),
    link({ id: "d", periodIndex: 3, state: null }),
    link({ id: "e", periodIndex: 4, status: "unlinked", state: { issueState: "open" } }),
  ];
  assert.deepEqual(summarizeLinks(links), { published: 4, closed: 1, open: 1, missing: 1 });
  assert.deepEqual(summarizeLinks([]), { published: 0, closed: 0, open: 0, missing: 0 });
  assert.deepEqual(summarizeLinks(undefined), { published: 0, closed: 0, open: 0, missing: 0 });
});

test("allSyncedWithin: the client-side sync throttle", () => {
  const fresh = link({ lastSyncedAt: new Date(NOW - 5 * 60_000).toISOString() });
  const old = link({ id: "o", periodIndex: 1, lastSyncedAt: new Date(NOW - 20 * 60_000).toISOString() });
  const never = link({ id: "n", periodIndex: 2, lastSyncedAt: null });
  assert.equal(allSyncedWithin([fresh], 15 * 60_000, NOW), true);
  assert.equal(allSyncedWithin([fresh, old], 15 * 60_000, NOW), false);
  assert.equal(allSyncedWithin([fresh, never], 15 * 60_000, NOW), false);
  // Unlinked rows don't hold the throttle open; no links → nothing to sync.
  assert.equal(allSyncedWithin([{ ...never, status: "unlinked" }], 15 * 60_000, NOW), true);
  assert.equal(allSyncedWithin([], 15 * 60_000, NOW), true);
});

test("isGithubRepoSlug accepts owner/name only", () => {
  assert.equal(isGithubRepoSlug("acme/app"), true);
  assert.equal(isGithubRepoSlug("acme/app.js"), true);
  assert.equal(isGithubRepoSlug("group/sub/project"), false);
  assert.equal(isGithubRepoSlug("acme"), false);
  assert.equal(isGithubRepoSlug("acme/ap p"), false);
  assert.equal(isGithubRepoSlug(""), false);
});

test("publishErrorCopy and retryMinutes", () => {
  assert.equal(publishErrorCopy({ code: "integration_not_connected" }), "Connect GitHub in Settings to publish.");
  assert.match(publishErrorCopy({ code: "rate_limited", retryAfterMs: 125_000 }), /try again in 3 min/);
  assert.equal(publishErrorCopy({ code: "weird", message: "boom" }), "boom");
  assert.equal(retryMinutes(0), 1);
  assert.equal(retryMinutes(59_000), 1);
  assert.equal(retryMinutes(60_001), 2);
});

// ─── Phase 3 ─────────────────────────────────────────────────────────

const pr = (over = {}) => ({
  repo: "acme/app",
  number: 7,
  prId: 7000,
  url: "https://github.com/acme/app/pull/7",
  title: "Ship it",
  state: "merged",
  mergedAt: "2026-10-10T09:00:00Z",
  author: "dev",
  ...over,
});

test("prTone / prStateLabel: merged mint, open sky, closed neutral", () => {
  assert.equal(prTone("merged"), "mint");
  assert.equal(prTone("open"), "sky");
  assert.equal(prTone("closed"), "neutral");
  assert.equal(prTone("weird"), "neutral");
  assert.equal(prStateLabel("merged"), "Merged");
  assert.equal(prStateLabel(undefined), "Unknown");
});

test("prEvidenceId matches the merged-PR feed's id (mr- + gh-<id>)", () => {
  assert.equal(prEvidenceId(pr()), "mr-gh-7000");
  assert.equal(prEvidenceId({}), null);
  assert.deepEqual(prEvidenceItem(pr()), {
    id: "mr-gh-7000",
    kind: "merged-pr",
    ref: "!7",
    title: "Ship it",
    date: "Oct 10",
    impact: "",
  });
  assert.equal(prEvidenceItem(null), null);
});

test("collectLinkedPrs dedupes by prId across links, tags periods, merged first", () => {
  const a = link({ id: "a", periodIndex: 0, periodLabel: "Jan", state: { issueState: "open", linkedPrs: [pr({ prId: 1, state: "open", mergedAt: null }), pr()] } });
  const b = link({ id: "b", periodIndex: 1, periodLabel: "Feb", state: { issueState: "open", linkedPrs: [pr(), pr({ prId: 2, mergedAt: "2026-10-12T09:00:00Z" })] } });
  const gone = link({ id: "c", periodIndex: 2, status: "unlinked", state: { linkedPrs: [pr({ prId: 3 })] } });
  const out = collectLinkedPrs([a, b, gone]);
  assert.deepEqual(out.map((p) => p.prId), [2, 7000, 1]);
  assert.deepEqual(out.find((p) => p.prId === 7000).periods, ["Jan", "Feb"]);
  assert.deepEqual(collectLinkedPrs(null), []);
});

test("threadItems interleaves replies and posts oldest first", () => {
  const items = threadItems(
    [
      { commentId: 1, author: "dev", body: "b", createdAt: "2026-10-02T00:00:00Z", url: "u" },
      { commentId: 2, author: "dev", body: "c", createdAt: "2026-10-04T00:00:00Z", url: "u" },
    ],
    [{ kind: "tier_verdict", sourceId: "x", commentId: 9, postedAt: "2026-10-03T00:00:00Z" }],
  );
  assert.deepEqual(items.map((i) => i.type), ["reply", "post", "reply"]);
  assert.deepEqual(threadItems(undefined, undefined), []);
  assert.equal(postKindLabel("tier_verdict"), "Tier verdict");
  assert.equal(postKindLabel("manager_note"), "1:1 note");
});

test("hasPost, defaultGradeLink, linkOptionLabel", () => {
  const posted = link({ posts: [{ kind: "manager_note", sourceId: "n1", commentId: 1, postedAt: "" }] });
  assert.equal(hasPost(posted, "manager_note", "n1"), true);
  assert.equal(hasPost(posted, "tier_verdict", "n1"), false);
  assert.equal(hasPost(null, "manager_note", "n1"), false);

  const open = link({ id: "o", periodIndex: 2, state: { issueState: "open" } });
  const closedOld = link({ id: "c1", periodIndex: 0, state: { issueState: "closed", closedAt: "2026-09-01T00:00:00Z" } });
  const closedNew = link({ id: "c2", periodIndex: 1, state: { issueState: "closed", closedAt: "2026-10-01T00:00:00Z" } });
  assert.equal(defaultGradeLink([open, closedOld, closedNew]).id, "c2");
  assert.equal(defaultGradeLink([open]).id, "o");
  assert.equal(defaultGradeLink([link({ status: "pending", issueNumber: null })]), null);
  assert.equal(defaultGradeLink(undefined), null);
  assert.equal(linkOptionLabel(link()), "Week 1 · acme/app#123");
});

test("flagCopy: peach for hard gaps, lemon for soft ones, plain-language titles", () => {
  for (const f of ["closed_no_evidence", "issue_missing", "open_past_deadline"]) {
    assert.equal(flagCopy(f).tone, "peach", f);
  }
  for (const f of ["evidence_no_issue", "stale_period"]) {
    assert.equal(flagCopy(f).tone, "lemon", f);
  }
  assert.match(flagCopy("closed_no_evidence").title, /^Closed on GitHub, but nothing logged here/);
  for (const f of CORRELATION_FLAGS) {
    const c = flagCopy(f);
    assert.ok(c.label && c.title, f);
  }
  assert.equal(flagCopy("whatever").tone, "neutral");
});

test("correlationSummary counts periods, flagged periods and each flag", () => {
  const goals = [
    {
      goalId: "g1",
      periods: [
        { periodIndex: 0, flags: ["closed_no_evidence"] },
        { periodIndex: 1, flags: ["closed_no_evidence", "stale_period"] },
        { periodIndex: 2, flags: [] },
      ],
    },
    { goalId: "g2", periods: [{ periodIndex: 0, flags: ["closed_no_evidence", "issue_missing"] }] },
  ];
  const s = correlationSummary(goals);
  assert.equal(s.periods, 4);
  assert.equal(s.flagged, 3);
  assert.equal(s.closed_no_evidence, 3);
  assert.equal(s.stale_period, 1);
  assert.equal(s.issue_missing, 1);
  assert.equal(s.open_past_deadline, 0);
  assert.equal(
    correlationSummaryLine(s),
    "3 periods closed on GitHub without evidence · 1 issue missing on GitHub · 1 period published before a plan change",
  );
  assert.deepEqual(correlationSummary(undefined), {
    periods: 0,
    flagged: 0,
    closed_no_evidence: 0,
    issue_missing: 0,
    open_past_deadline: 0,
    evidence_no_issue: 0,
    stale_period: 0,
  });
  assert.equal(correlationSummaryLine(correlationSummary([])), "");
  assert.match(
    correlationSummaryLine(correlationSummary([{ periods: [{ flags: [] }] }])),
    /agree/,
  );
});

test("correlationChipLink feeds the shared chip", () => {
  assert.equal(correlationChipLink(null), null);
  const l = correlationChipLink({
    number: 12,
    url: "https://github.com/acme/app/issues/12",
    state: "closed",
    stateReason: "completed",
    closedAt: "2026-10-01T00:00:00Z",
    tasks: { done: 2, total: 2 },
    linkId: "abc",
    linkStatus: "linked",
    repo: "acme/app",
    lastSyncedAt: new Date(NOW - 60_000).toISOString(),
    stale: false,
  });
  assert.equal(l.id, "abc");
  assert.equal(l.issueNumber, 12);
  assert.equal(chipState(l, NOW).tone, "mint");
  const failed = correlationChipLink({ number: null, url: null, state: null, linkId: "f", linkStatus: "failed", repo: "acme/app" });
  assert.equal(chipState(failed, NOW).label, "Publish failed");
});

test("prCountLabel and readingLabel", () => {
  assert.equal(prCountLabel([]), "—");
  assert.equal(prCountLabel([{ state: "merged" }, { state: "open" }]), "1/2 merged");
  assert.equal(readingLabel(null), "—");
  assert.match(readingLabel({ at: "2026-10-05T12:00:00Z", source: "manual" }), /^Logged Oct 5$/);
  assert.match(readingLabel({ at: "2026-10-05T12:00:00Z", source: "github" }), /^From GitHub Oct 5$/);
});
