import test from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";

import type { ReviewPacketPayload } from "../../db/types.js";
import { parsePacketBody } from "./packet-body.js";

const V1 = {
  level: "Senior",
  rangeLabel: "Jan – Jun 2026",
  narrative: "A good half.",
  markdown: "# Packet",
  goals: [{ goalId: "g1", title: "Ship X", l1Title: "Delivery", tier: "achieved", reading: "3 of 4", statusLabel: "on track" }],
  starredCount: 2,
};

const LADDER: ReviewPacketPayload["objectives"][number]["goals"][number]["tiers"] = { notAchieved: "<2", achieved: "3", overAchieved: "4", roleModel: null };

const PAYLOAD: ReviewPacketPayload = {
  range: { label: "Jan – Jun 2026", start: "2026-01-01", end: "2026-06-30" },
  cycleKey: "2026",
  submitter: { displayName: "Dana", level: "Senior", department: "Platform" },
  objectives: [
    {
      id: "l1",
      title: "Delivery",
      weight: 60,
      reading: "on track",
      goals: [
        {
          id: "g1",
          title: "Ship X",
          kind: "COMPOSED",
          cadence: "monthly",
          target: "4 releases",
          reading: "3 of 4",
          statusLabel: "on track",
          statusReason: "one release left",
          tiers: LADDER,
          cadenceTiers: LADDER,
          verdict: { tier: "achieved", reasoning: "3 shipped", lowConfidence: false, gradedAt: "2026-06-01T00:00:00.000Z" },
          windows: [
            { key: "2026-01", label: "Jan", state: "done", verdict: "achieved" },
            { key: "2026-02", label: "Feb", state: "missed" },
          ],
          evidence: [{ at: "2026-01-15", text: "Released v1", link: "https://example.com/v1" }],
        },
        {
          id: "g2",
          title: "Mentor",
          kind: "COUNTER",
          managerVerdict: { tier: "over_achieved", note: "great", gradedAt: "2026-06-02T00:00:00.000Z" },
          verdict: { tier: "achieved", reasoning: "ok", lowConfidence: true, gradedAt: null },
          windows: [],
          evidence: [],
        },
      ],
    },
  ],
  untracked: [{ id: "g9", title: "Learn Rust", l1Title: "Growth" }],
  totals: { goals: 3, tracked: 2, byTier: { notAchieved: 0, achieved: 1, overAchieved: 1, roleModel: 0 } },
};

const V2 = { version: 2, template: "scorecard", payload: PAYLOAD };

test("v1 body parses as before", () => {
  const r = parsePacketBody(V1);
  assert.equal(r.version, 1);
  if (r.version !== 1) return;
  assert.equal(r.narrative, "A good half.");
  assert.equal(r.markdown, "# Packet");
  assert.equal(r.starredCount, 2);
  assert.deepEqual(r.goals, V1.goals);
});

test("explicit version 1 is the same as missing", () => {
  assert.equal(parsePacketBody({ ...V1, version: 1 }).version, 1);
});

test("v1 still requires markdown", () => {
  const { markdown: _m, ...rest } = V1;
  assert.throws(() => parsePacketBody(rest), ZodError);
});

test("v2 body derives flat goal rows from the payload", () => {
  const r = parsePacketBody(V2);
  assert.equal(r.version, 2);
  if (r.version !== 2) return;
  assert.deepEqual(r.goals[0], { goalId: "g1", title: "Ship X", l1Title: "Delivery", tier: "achieved", reading: "3 of 4", statusLabel: "on track" });
  // Manager verdict outranks the AI verdict on the flat row.
  assert.equal(r.goals[1].tier, "over_achieved");
  assert.equal(r.goals[1].reading, null);
  assert.equal(r.goals.at(-1)!.statusLabel, "No tracker yet");
  assert.deepEqual(r.goals.at(-1), { goalId: "g9", title: "Learn Rust", l1Title: "Growth", tier: null, reading: null, statusLabel: "No tracker yet" });
  assert.equal(r.goalCount, r.goals.length);
  assert.equal(r.template, "scorecard");
  assert.equal(r.level, "Senior");
  assert.equal(r.rangeLabel, "Jan – Jun 2026");
  assert.equal(r.markdown, undefined);
  assert.equal(r.payload.objectives[0].goals[0].windows[0].state, "done");
});

test("v2 keeps an optional markdown", () => {
  const r = parsePacketBody({ ...V2, markdown: "# Frozen" });
  assert.equal(r.markdown, "# Frozen");
});

test("v2 rejects unknown template and oversize payload", () => {
  assert.throws(() => parsePacketBody({ ...V2, template: "pdf" }), ZodError);
  const big = structuredClone(V2);
  // 150 evidence items × 3 goals × ~1,000 chars ≈ 450,000 chars — every
  // field under its own cap, the whole over 400,000.
  const item = { at: "2026-01-01", text: "x".repeat(1_000) };
  big.payload.objectives[0].goals = [0, 1, 2].map((i) => ({
    ...V2.payload.objectives[0].goals[0],
    id: `g${i}`,
    evidence: Array.from({ length: 150 }, () => item),
  }));
  assert.throws(() => parsePacketBody(big), ZodError);
});

test("v2 rejects a bad verdict tier and an unknown version", () => {
  const bad = structuredClone(V2);
  (bad.payload.objectives[0].goals[0].verdict as { tier: string }).tier = "great";
  assert.throws(() => parsePacketBody(bad), ZodError);
  assert.throws(() => parsePacketBody({ ...V2, version: 3 }), ZodError);
});
