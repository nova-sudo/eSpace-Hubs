import test from "node:test";
import assert from "node:assert/strict";

import { sharedGoalStatus } from "./goal-health.js";
import { aggregateWindows } from "./goal-detail.js";

const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const NOW = noon("2026-09-29"); // W40
const counter = { widget: "COUNTER", manual: { cadence: "weekly", unit: "h" } };

test("manager board: a missed due week reads Behind (never 'Tracking')", () => {
  const s = sharedGoalStatus({
    spec: counter,
    readiness: "ready",
    entryTs: [noon("2026-09-02"), noon("2026-09-09")],
    lockedKeys: new Set(),
    createdAt: new Date(noon("2026-09-01")),
    hireDate: null,
    tier: null,
    now: NOW,
  });
  assert.equal(s.status, "behind");
  assert.equal(s.label, "Behind");
  assert.equal(s.tone, "peach");
  assert.match(s.reason ?? "", /Gone quiet/);
  assert.deepEqual(s.logged, { done: 2, due: 4, owed: 2 });
});

test("manager board: settled weeks and this week's gap are On pace", () => {
  const s = sharedGoalStatus({
    spec: counter,
    readiness: "ready",
    entryTs: [noon("2026-09-15")],
    lockedKeys: new Set(["2026-W39"]),
    createdAt: new Date(noon("2026-09-14")),
    hireDate: null,
    tier: null,
    now: NOW,
  });
  assert.equal(s.status, "on-pace");
});

test("manager board: pre-tracker weeks are never owed", () => {
  const s = sharedGoalStatus({
    spec: counter,
    readiness: "ready",
    entryTs: [],
    lockedKeys: new Set(),
    createdAt: new Date(noon("2026-09-28")),
    hireDate: null,
    tier: null,
    now: NOW,
  });
  assert.equal(s.status, "not-logged");
});

test("manager board: readiness, no tracker and auto map to the shared states", () => {
  const base = { entryTs: [], lockedKeys: new Set<string>(), createdAt: null, hireDate: null, tier: null, now: NOW };
  assert.equal(sharedGoalStatus({ ...base, spec: null, readiness: "unclassified" }).label, "No tracker yet");
  assert.equal(sharedGoalStatus({ ...base, spec: counter, readiness: "pending-approval" }).label, "Needs setup");
  assert.equal(
    sharedGoalStatus({ ...base, spec: { widget: "MERGED_COUNT" }, readiness: "ready" }).label,
    "Auto-tracked",
  );
  assert.equal(
    sharedGoalStatus({ ...base, spec: counter, readiness: "ready", tier: "role_model" }).label,
    "Exceeding",
  );
});

test("grade drawer readings are summed per window, newest first", () => {
  const rows = aggregateWindows({
    spec: counter,
    entries: [
      { ts: new Date(noon("2026-09-28")), value: 1 },
      { ts: new Date(noon("2026-09-29")), value: 1.5 },
      { ts: new Date(noon("2026-09-21")), value: 2 },
    ],
    now: NOW,
  });
  assert.deepEqual(
    rows?.map((r) => [r.label, r.total, r.entries, r.unit]),
    [
      ["W40", 2.5, 2, "h"],
      ["W39", 2, 1, "h"],
    ],
  );
});
