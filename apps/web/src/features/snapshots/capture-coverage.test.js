import test from "node:test";
import assert from "node:assert/strict";

import { SPEC_KINDS } from "@espace-devhub/shared/goal-specs";
import { captureGoalReadings } from "./capture-readings.js";
import { goalCompliance } from "./compliance.js";

/* ── every spec kind produces a snapshot reading ── */

// The regression this guards: 8 of 18 kinds used to fall through the
// reader switch's `default: return null`, so CI/CD, COMPOSED and
// incident goals had an EMPTY snapshot stream forever — compliance read
// empty, evidence printed "Tracked via dashboard", the grader had
// nothing. Any kind added to SPEC_KINDS must either get a reader or be
// added to EXCLUDED here with a reason.
const EXCLUDED = new Set([
  // (none — every kind is currently routed)
]);

test("captureGoalReadings produces a reading for every SPEC_KINDS member", () => {
  const kinds = Object.values(SPEC_KINDS);
  const l2s = kinds.map((kind, i) => ({ id: `g-${i}-${kind}`, l2s: [] }));
  const specs = new Map(
    kinds.map((kind, i) => [
      `g-${i}-${kind}`,
      { widget: kind, goalId: `g-${i}-${kind}`, manual: { cadence: "weekly" } },
    ]),
  );

  const out = captureGoalReadings({
    weekStart: new Date(2026, 5, 7), // Sun
    weekEnd: new Date(2026, 5, 12), // Fri 00:00
    goals: { l1s: [{ id: "l1-root", l2s }] },
    specs,
    mrs: [],
    events: [],
    tickets: [],
    allInputs: {},
    readLive: () => ({ value: "87%" }),
  });

  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    if (EXCLUDED.has(kind)) continue;
    const reading = out[`g-${i}-${kind}`];
    assert.ok(
      reading,
      `${kind} produced no snapshot reading — its compliance stream will be empty forever`,
    );
    assert.ok(reading.cadenceWindow, `${kind} reading carries no cadenceWindow`);
  }
});

test("live-reading freeze keeps the leading number, never a windowMet verdict", () => {
  const out = captureGoalReadings({
    weekStart: new Date(2026, 5, 7),
    weekEnd: new Date(2026, 5, 12),
    goals: { l1s: [{ id: "l1", l2s: [{ id: "g-build" }] }] },
    specs: new Map([[
      "g-build",
      { widget: SPEC_KINDS.BUILD_PASS_RATE, manual: { cadence: "weekly" } },
    ]]),
    mrs: [],
    events: [],
    tickets: [],
    allInputs: {},
    readLive: (id) => (id === "g-build" ? { value: "92% · 40 runs" } : null),
  });
  assert.equal(out["g-build"].cumulative, 92);
  assert.equal(out["g-build"].windowMet, null);
});

/* ── compliance denominator counts missed windows ── */

function monthLabel(offset) {
  const d = new Date();
  d.setDate(15);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function snap(iso, goalId, cadenceWindow, windowMet) {
  return {
    capturedAt: iso,
    goalReadings: {
      [goalId]: { cadence: "monthly", cadenceWindow, windowMet },
    },
  };
}

// The frozen-denominator regression: windows with no snapshot used to
// not exist at all, so "opened the app in month -5 and month -1" read
// as 100% · 2 of 2. They now count as missed.
test("months with no snapshot count as missed windows, not non-existence", () => {
  const goalId = "g1";
  const snapshots = [
    snap("2026-06-01T00:00:00Z", goalId, monthLabel(-1), false),
    snap("2026-02-01T00:00:00Z", goalId, monthLabel(-5), true),
  ];
  const c = goalCompliance(snapshots, goalId);
  // Expected closed windows: -5, -4, -3, -2, -1 → five. Two have
  // readings (one met), three are missed.
  assert.equal(c.missedWindows, 3);
  assert.equal(c.totalWindows, 5);
  assert.equal(c.metWindows, 1);
  assert.equal(c.pct, 20);
});

test("a fully-covered stream has no missed windows", () => {
  const goalId = "g2";
  const snapshots = [
    snap("2026-06-01T00:00:00Z", goalId, monthLabel(-1), true),
    snap("2026-05-01T00:00:00Z", goalId, monthLabel(-2), true),
  ];
  const c = goalCompliance(snapshots, goalId);
  assert.equal(c.missedWindows, 0);
  assert.equal(c.totalWindows, 2);
  assert.equal(c.pct, 100);
});
