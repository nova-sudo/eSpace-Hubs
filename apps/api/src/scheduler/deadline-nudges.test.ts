import test from "node:test";
import assert from "node:assert/strict";
import { deadlineNudgeSkip, formatDueDay } from "./deadline-nudges.js";

test("formatDueDay: short day, year only when it isn't this year", () => {
  const now = new Date("2026-09-29T10:00:00Z");
  assert.equal(formatDueDay("2026-06-30", now), "30 Jun");
  assert.equal(formatDueDay("2025-01-05", now), "5 Jan 2025");
  assert.equal(formatDueDay("not-a-date", now), "not-a-date");
});

test("deadlineNudgeSkip: goals the user can't act on are skipped", () => {
  assert.equal(deadlineNudgeSkip(null, true), "no_tracker");
  assert.equal(deadlineNudgeSkip({ widget: "COUNTER", delegated: { delegated: true, judge: "manager" } }, true), "delegated");
  assert.equal(deadlineNudgeSkip({ widget: "COUNTER", untrackable: { reason: "x" } }, false), "untrackable");
  assert.equal(deadlineNudgeSkip({ widget: "COMPOSED", approval: { status: "pending" } }, true), "awaiting_approval");
});

test("deadlineNudgeSkip: recurring trackers get due-soon but never overdue", () => {
  const weekly = { widget: "COUNTER", manual: { prompt: "p", cadence: "weekly" } };
  assert.equal(deadlineNudgeSkip(weekly, true), "recurring");
  assert.equal(deadlineNudgeSkip(weekly, false), null);
});

test("deadlineNudgeSkip: a one-off tracker is nudged", () => {
  const milestone = { widget: "MILESTONE", manual: { prompt: "p", cadence: "milestone" } };
  assert.equal(deadlineNudgeSkip(milestone, true), null);
  assert.equal(deadlineNudgeSkip({ widget: "MERGED_COUNT", kind: "auto" }, true), null);
});
