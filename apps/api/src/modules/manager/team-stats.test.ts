import test from "node:test";
import assert from "node:assert/strict";

import { gradingProgressFor, snapshotSeries, weekSortKey } from "./team-stats.js";

const at = (s: string) => new Date(s);

test("grading progress: latest grade per goal in the period, current goals only", () => {
  const out = gradingProgressFor(
    ["a", "b", "c"],
    [
      { goalId: "a", periodKey: "2026", tier: "not_achieved", gradedAt: at("2026-02-01"), ack: null },
      { goalId: "a", periodKey: "2026", tier: "achieved", gradedAt: at("2026-05-01"), ack: { at: at("2026-05-02"), disagree: false, note: "" } },
      { goalId: "b", periodKey: "2026", tier: "over_achieved", gradedAt: at("2026-05-01"), ack: { at: at("2026-05-02"), disagree: true, note: "no" } },
      { goalId: "c", periodKey: "2025", tier: "achieved", gradedAt: at("2025-05-01"), ack: null },
      { goalId: "gone", periodKey: "2026", tier: "achieved", gradedAt: at("2026-05-01"), ack: null },
    ],
    "2026",
  );
  assert.equal(out.total, 3);
  assert.equal(out.graded, 2);
  assert.deepEqual(out.byTier, { not_achieved: 0, achieved: 1, over_achieved: 1, role_model: 0 });
  assert.equal(out.acknowledged, 1);
  assert.equal(out.disputed, 1);
});

test("week keys sort by year then week; legacy labels borrow the capture year", () => {
  assert.ok(weekSortKey("W2-2027", at("2027-01-10")) > weekSortKey("W52-2026", at("2026-12-27")));
  assert.equal(weekSortKey("W16", at("2025-04-15")), 202516);
});

test("snapshot series: oldest first, one point per week, provider gaps read as null", () => {
  const base = { capturedBy: "manual" as const, partial: false, gaps: [] as string[], reviews: 1, goalReadings: {} };
  const out = snapshotSeries([
    { ...base, week: "W38-2026", capturedAt: at("2026-09-20"), merged: 4 },
    { ...base, week: "W37-2026", capturedAt: at("2026-09-13"), merged: 2 },
    { ...base, week: "W38-2026", capturedAt: at("2026-09-21"), merged: 6 },
    {
      ...base,
      week: "W39-2026",
      capturedAt: at("2026-09-27"),
      capturedBy: "auto",
      partial: true,
      gaps: ["provider-metrics"],
      merged: 0,
      goalReadings: {
        g1: { cadence: "weekly", cadenceWindow: "W39-2026", weekContribution: 1, cumulative: 1, target: null, windowMet: true, onPace: null },
        g2: { cadence: "weekly", cadenceWindow: "W39-2026", weekContribution: 0, cumulative: 0, target: null, windowMet: false, onPace: null },
      },
    },
  ]);
  assert.deepEqual(out.map((p) => p.week), ["W37-2026", "W38-2026", "W39-2026"]);
  assert.deepEqual(out.map((p) => p.merged), [2, 6, null]);
  assert.equal(out[2].goalsTracked, 2);
  assert.equal(out[2].goalsMet, 1);
});
