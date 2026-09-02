import test from "node:test";
import assert from "node:assert/strict";

import { computeCompliance } from "./compliance.js";

// Audit #237: compliance bucketed from the FIRST ENTRY in fixed 30-day
// "months", so Jan 31 and Feb 1 shared a window while the stepper (and
// the snapshot capture) called them March-adjacent calendar months.
// Compliance must now use the same calendar windows everything else does.
test("monthly compliance buckets by calendar month, not 30-day strides from the first entry", () => {
  const now = Date.UTC(2026, 1, 15); // Feb 15
  const target = { op: ">=", value: 3 };
  const entries = [
    { ts: Date.UTC(2026, 0, 31), value: 3 }, // Jan 31 → January window, met
    { ts: Date.UTC(2026, 1, 1), value: 1 }, // Feb 1 → February window, 1/3
  ];
  const c = computeCompliance(entries, target, "monthly", now);
  assert.equal(c.totalWindows, 2);
  assert.equal(c.metWindows, 1);
  assert.equal(c.latestWindowMet, false);
  // (1.0 + 1/3) / 2 → 67%
  assert.equal(c.pct, 67);
});

test("windows run from the first entry's window through now — later empty windows count against you", () => {
  const now = Date.UTC(2026, 3, 10); // Apr 10
  const entries = [{ ts: Date.UTC(2026, 0, 5), value: 5 }]; // only January
  const c = computeCompliance(entries, { op: ">=", value: 5 }, "monthly", now);
  assert.equal(c.totalWindows, 4); // Jan, Feb, Mar, Apr
  assert.equal(c.metWindows, 1);
  assert.equal(c.pct, 25);
});

test("non-bucketing cadences and missing targets return null", () => {
  const entries = [{ ts: Date.UTC(2026, 0, 5), value: 1 }];
  assert.equal(computeCompliance(entries, { op: ">=", value: 1 }, "milestone"), null);
  assert.equal(computeCompliance(entries, null, "weekly"), null);
  assert.equal(computeCompliance([], { op: ">=", value: 1 }, "weekly"), null);
});
