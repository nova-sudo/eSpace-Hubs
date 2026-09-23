import test from "node:test";
import assert from "node:assert/strict";

import { ticketTypeSharePct, parseTicketTypes, mrJiraKeys } from "./ticket-type.js";
import { extractJiraKeys, hasJiraKey } from "../../../lib/regex.js";

const mr = (title, types, extra = {}) => ({
  merged_at: "2026-03-01T00:00:00.000Z",
  title,
  jira_issue_types: types,
  ...extra,
});

test("extractJiraKeys returns real keys, de-duped, and skips the tech-token denylist", () => {
  assert.deepEqual(extractJiraKeys("PAY-12 fix (PAY-12) see UTF-8 and SHA-256, BID-7"), ["PAY-12", "BID-7"]);
  assert.deepEqual(extractJiraKeys(""), []);
  assert.deepEqual(extractJiraKeys(null), []);
  assert.equal(hasJiraKey("bump to SHA-256"), false);
  assert.equal(hasJiraKey("PAY-4812: refund"), true);
});

test("mrJiraKeys reads title, description and branch — the same fields linkage reads", () => {
  assert.deepEqual(
    mrJiraKeys({ title: "PAY-1 x", description: "closes PAY-2", source_branch: "feat/PAY-3-thing" }),
    ["PAY-1", "PAY-2", "PAY-3"],
  );
});

test("parseTicketTypes lower-cases, splits commas, defaults to bug", () => {
  assert.deepEqual(parseTicketTypes("Bug, Defect"), ["bug", "defect"]);
  assert.deepEqual(parseTicketTypes(["Story"]), ["story"]);
  assert.deepEqual(parseTicketTypes(""), ["bug"]);
  assert.deepEqual(parseTicketTypes(undefined), ["bug"]);
});

test("a PR counts when any referenced key is a watched type; unlinked PRs are unresolved, not 'not a bug'", () => {
  const out = ticketTypeSharePct([
    mr("PAY-1 fix", { "PAY-1": "bug" }),
    mr("PAY-2 story", { "PAY-2": "story" }),
    mr("PAY-3 and PAY-4", { "PAY-3": "task", "PAY-4": "bug" }),
    mr("no key here", undefined),
    mr("PAY-9 not returned by jira", undefined),
  ]);
  assert.equal(out.total, 5);
  assert.equal(out.matched, 2);
  assert.equal(out.unmatched, 1);
  assert.equal(out.unresolved, 2);
  assert.equal(out.pct, 40);
  assert.deepEqual(out.seenTypes, ["bug"]);
});

test("watched types are per-spec and case-insensitive", () => {
  const out = ticketTypeSharePct([mr("PAY-1", { "PAY-1": "story" }), mr("PAY-2", { "PAY-2": "bug" })], "Story");
  assert.equal(out.matched, 1);
  assert.deepEqual(out.seenTypes, ["story"]);
});

test("an empty window is null, not 0%", () => {
  assert.equal(ticketTypeSharePct([]), null);
  assert.equal(ticketTypeSharePct([{ merged_at: null, title: "PAY-1" }]), null);
});
