import test from "node:test";
import assert from "node:assert/strict";

import { autoSnapshotNeeded, backfillFeedsNeeded, specsNeedJiraTickets } from "./snapshot-gates.js";

test("auto-snapshot fetches nothing until the history has hydrated", () => {
  assert.equal(autoSnapshotNeeded({ fetched: false, snapshots: [], weekLabel: "W39-2026" }), false);
});

test("auto-snapshot fetches nothing when this week's snapshot exists", () => {
  const snapshots = [{ week: "W38-2026" }, { week: "W39-2026" }];
  assert.equal(autoSnapshotNeeded({ fetched: true, snapshots, weekLabel: "W39-2026" }), false);
});

test("auto-snapshot arms its feeds only when the week is missing", () => {
  assert.equal(
    autoSnapshotNeeded({ fetched: true, snapshots: [{ week: "W38-2026" }], weekLabel: "W39-2026" }),
    true,
  );
  assert.equal(autoSnapshotNeeded({ fetched: true, snapshots: [], weekLabel: "W39-2026" }), true);
});

test("backfill fetches only once the user asks for a run", () => {
  assert.equal(backfillFeedsNeeded({ requested: false }), false);
  assert.equal(backfillFeedsNeeded({ requested: true }), true);
});

test("Jira is only fetched for ticket-cycle trackers", () => {
  assert.equal(specsNeedJiraTickets(new Map([["g1", { widget: "MERGED_COUNT" }]])), false);
  assert.equal(specsNeedJiraTickets(new Map([["g1", { widget: "TICKET_CYCLE" }]])), true);
  assert.equal(specsNeedJiraTickets({ g1: { widget: "COUNTER" } }), false);
  assert.equal(specsNeedJiraTickets(null), false);
});
