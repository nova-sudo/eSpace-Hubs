import { test } from "node:test";
import assert from "node:assert/strict";

import { buildPacketPayload, MAX_PAYLOAD_CHARS } from "./build-packet-payload.js";
import { PACKET_TEMPLATES, TEMPLATE_IDS } from "./packet-model.js";

const NO_READERS = { readTierPolicy: () => null, readManagerVerdict: () => null };

const L1A = { id: "l1-a", title: "Delivery", weightage: 60 };
const L1B = { id: "l1-b", title: "Quality", weightage: "40" };

const spec = (widget, extra = {}) => ({
  widget,
  tiers: { notAchieved: "<5", achieved: "5+", overAchieved: "10+", roleModel: "15+" },
  ...extra,
});

const verdict = (tier, extra = {}) => ({
  tier,
  reasoning: `graded ${tier}`,
  confidence: "high",
  awaiting: false,
  pendingSetup: false,
  ...extra,
});

function fixture() {
  return {
    goalReadings: [
      { level: "L1", goal: L1A, parentL1: null, spec: spec("COUNTER"), reading: { value: "on track" }, verdict: null, evidence: [] },
      {
        level: "L2",
        goal: { id: "g1", title: "Ship features", weightage: 30 },
        parentL1: L1A,
        spec: spec("MERGED_COUNT", { source: { target: { op: ">=", value: 12, period: "month" } } }),
        reading: { value: "14 merged", statusLabel: "On track", statusTone: "ok", statusReason: "ahead" },
        verdict: verdict("achieved", { confidence: "low", gradedAt: "2026-10-01T00:00:00.000Z" }),
        evidence: [{ ts: Date.UTC(2026, 8, 1), text: "Shipped billing", url: "https://x.test/1" }],
      },
      {
        level: "L2",
        goal: { id: "g2", title: "Mentor", weightage: 30 },
        parentL1: L1A,
        spec: spec("COUNTER", { manual: { cadence: "monthly", prompt: "p" } }),
        reading: { value: "3 sessions", statusLabel: "On track", statusTone: "ok", statusReason: null },
        verdict: verdict("over_achieved"),
        evidence: [],
      },
      // L2 whose L1 row is missing (L1 has no spec) — objective from parentL1.
      {
        level: "L2",
        goal: { id: "g3", title: "Reduce bugs", weightage: 40 },
        parentL1: L1B,
        spec: spec("TICKET_TYPE_SHARE"),
        reading: { value: "8%", statusLabel: "On track", statusTone: "ok", statusReason: null },
        verdict: verdict("achieved"),
        evidence: [{ ts: "2026-09-02T00:00:00.000Z", text: "Postmortem", link: "https://x.test/pm" }],
      },
    ],
    untracked: [{ id: "g4", title: "Write docs", l1Title: "Quality" }],
    submitter: { displayName: "Ada", level: "Senior", department: "Platform" },
    rangeLabel: "2026",
    rangeStart: "2026-01-01",
    rangeEnd: "2026-10-13",
    cycleKey: "2026",
  };
}

test("groups goals into objectives by parentL1 with weight from weightage", () => {
  const p = buildPacketPayload(fixture(), NO_READERS);
  assert.deepEqual(
    p.objectives.map((o) => [o.id, o.title, o.weight, o.goals.map((g) => g.id)]),
    [
      ["l1-a", "Delivery", 60, ["g1", "g2"]],
      ["l1-b", "Quality", 40, ["g3"]],
    ],
  );
  assert.equal(p.objectives[0].reading, "on track");
  assert.equal(p.objectives[1].reading, null);
});

test("totals count goals, tracked and graded tiers", () => {
  const p = buildPacketPayload(fixture(), NO_READERS);
  assert.deepEqual(p.totals, {
    goals: 4,
    tracked: 3,
    byTier: { achieved: 2, overAchieved: 1, notAchieved: 0, roleModel: 0 },
  });
  assert.deepEqual(p.untracked, [{ id: "g4", title: "Write docs", l1Title: "Quality" }]);
});

test("maps goal fields to the v2 schema shape", () => {
  const p = buildPacketPayload(
    {
      ...fixture(),
      windowsFor: (goalId) =>
        goalId === "g2" ? [{ key: "2026-09", label: "Sep", state: "met", verdict: "achieved" }, { key: "2026-10", label: "Oct", state: "open", verdict: "bogus" }] : [],
    },
    NO_READERS,
  );
  const [g1, g2] = p.objectives[0].goals;
  assert.equal(g1.kind, "MERGED_COUNT");
  assert.equal(g1.target, ">= 12 / month");
  assert.equal(g1.reading, "14 merged");
  assert.equal(g1.statusLabel, "On track");
  assert.equal(g1.statusReason, "ahead");
  assert.deepEqual(g1.tiers, { notAchieved: "<5", achieved: "5+", overAchieved: "10+", roleModel: "15+" });
  assert.deepEqual(g1.verdict, {
    tier: "achieved",
    reasoning: "graded achieved",
    lowConfidence: true,
    gradedAt: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(g1.managerVerdict, null);
  assert.deepEqual(g1.evidence, [
    { at: new Date(Date.UTC(2026, 8, 1)).toISOString(), text: "Shipped billing", link: "https://x.test/1" },
  ]);
  assert.equal(g2.cadence, "monthly");
  assert.deepEqual(g2.windows, [
    { key: "2026-09", label: "Sep", state: "met", verdict: "achieved" },
    { key: "2026-10", label: "Oct", state: "open", verdict: null },
  ]);
  assert.equal(p.objectives[1].goals[0].evidence[0].link, "https://x.test/pm");
  assert.deepEqual(p.range, { label: "2026", start: "2026-01-01", end: "2026-10-13" });
  assert.equal(p.cycleKey, "2026");
  assert.deepEqual(p.submitter, { displayName: "Ada", level: "Senior", department: "Platform" });
});

test("an awaiting or pending-setup verdict becomes null and is not counted", () => {
  const f = fixture();
  f.goalReadings[1].verdict = verdict("achieved", { awaiting: true });
  f.goalReadings[2].verdict = verdict("over_achieved", { pendingSetup: true });
  const p = buildPacketPayload(f, NO_READERS);
  assert.equal(p.objectives[0].goals[0].verdict, null);
  assert.equal(p.objectives[0].goals[1].verdict, null);
  assert.deepEqual(p.totals.byTier, { achieved: 1, overAchieved: 0, notAchieved: 0, roleModel: 0 });
});

test("zero goals → empty objectives and zero totals", () => {
  const p = buildPacketPayload({ goalReadings: [], untracked: [] }, NO_READERS);
  assert.deepEqual(p.objectives, []);
  assert.equal(p.totals.goals, 0);
  assert.equal(p.totals.tracked, 0);
  assert.deepEqual(p.range, { label: "", start: null, end: null });
  assert.deepEqual(p.submitter, { displayName: null, level: null, department: null });
});

test("injected readers supply policy ladders and the manager verdict", () => {
  const readers = {
    readTierPolicy: (id) => (id === "g1" ? { finalTiers: { notAchieved: "a", achieved: "b", overAchieved: "c", roleModel: "d" } } : null),
    readManagerVerdict: (id) => (id === "g1" ? { tier: "role_model", note: "great", gradedAt: "2026-10-02" } : null),
  };
  const g1 = buildPacketPayload(fixture(), readers).objectives[0].goals[0];
  assert.deepEqual(g1.tiers, { notAchieved: "a", achieved: "b", overAchieved: "c", roleModel: "d" });
  assert.deepEqual(g1.managerVerdict, { tier: "role_model", note: "great", gradedAt: "2026-10-02" });
});

test("clips strings and caps lists to the API schema", () => {
  const f = fixture();
  const long = "x".repeat(10_000);
  f.goalReadings[1].goal = { ...f.goalReadings[1].goal, title: long };
  f.goalReadings[1].verdict = verdict("achieved", { reasoning: long });
  f.goalReadings[1].evidence = Array.from({ length: 300 }, (_, i) => ({ ts: i, text: `${i}-${long}` }));
  const p = buildPacketPayload(
    { ...f, windowsFor: () => Array.from({ length: 90 }, (_, i) => ({ key: `w${i}`, label: "L", state: long })) },
    NO_READERS,
  );
  const g1 = p.objectives[0].goals[0];
  assert.equal(g1.title.length, 1_000);
  assert.equal(g1.verdict.reasoning.length, 4_000);
  assert.ok(g1.evidence.length <= 200);
  assert.ok(g1.evidence.every((e) => e.text.length <= 4_000));
  assert.ok(g1.windows.length <= 60);
  assert.equal(g1.windows.at(-1).key, "w89", "keeps the most recent windows");
  assert.ok(g1.windows.every((w) => w.state.length <= 30));
  assert.ok(JSON.stringify(p).length <= MAX_PAYLOAD_CHARS);
});

test("an oversized packet is trimmed under the whole-payload cap", () => {
  const long = "y".repeat(4_000);
  const goalReadings = Array.from({ length: 40 }, (_, i) => ({
    level: "L2",
    goal: { id: `g${i}`, title: `Goal ${i}`, weightage: 1 },
    parentL1: L1A,
    spec: spec("COUNTER"),
    reading: { value: "1" },
    verdict: verdict("achieved"),
    evidence: Array.from({ length: 50 }, (_, j) => ({ ts: j, text: `${j}${long}` })),
  }));
  const p = buildPacketPayload({ goalReadings, untracked: [] }, NO_READERS);
  assert.ok(JSON.stringify(p).length <= MAX_PAYLOAD_CHARS);
  assert.equal(p.objectives[0].goals.length, 40, "goals are never dropped to fit");
  assert.equal(p.totals.byTier.achieved, 40);
});

test("520 long-titled goals: capped at 500 rows, under the size cap", () => {
  const long = "w".repeat(4_000);
  const goalReadings = Array.from({ length: 520 }, (_, i) => ({
    level: "L2",
    goal: { id: `g${i}`, title: long },
    parentL1: L1A,
    spec: spec("COUNTER"),
    reading: { value: long, statusLabel: long, statusReason: long },
    verdict: verdict("achieved", { reasoning: long }),
    evidence: [{ ts: 1, text: long }],
  }));
  const p = buildPacketPayload(
    { goalReadings, untracked: [{ id: "u", title: long, l1Title: long }] },
    { ...NO_READERS, readManagerVerdict: () => ({ tier: "achieved", note: long, gradedAt: null }) },
  );
  assert.ok(JSON.stringify(p).length <= MAX_PAYLOAD_CHARS);
  assert.equal(p.objectives[0].goals.length, 500, "capped at the API's 500 goal rows");
  assert.deepEqual(p.untracked, [], "no room left for untracked rows");
  assert.equal(p.totals.goals, 500);
});

test("packet templates list the four template ids", () => {
  assert.deepEqual(TEMPLATE_IDS, ["scorecard", "journey", "deck", "dossier"]);
  for (const t of PACKET_TEMPLATES) {
    assert.ok(t.label && t.blurb);
  }
});
