import test from "node:test";
import assert from "node:assert/strict";

import { tierDelta } from "./tier-diff.js";

test("tierDelta reports an up-move with steps and a display label", () => {
  assert.deepEqual(tierDelta("achieved", "over_achieved"), {
    from: "achieved",
    to: "over_achieved",
    direction: "up",
    steps: 1,
    label: "Achieved → Over achieved",
  });
  assert.equal(tierDelta("not_achieved", "role_model").steps, 3);
});

test("tierDelta reports a down-move honestly, including multi-rung drops", () => {
  const d = tierDelta("role_model", "not_achieved");
  assert.equal(d.direction, "down");
  assert.equal(d.steps, 3);
});

// BR-11: TIER_ORDER.indexOf(null) = -1 must never read as "worse than
// not_achieved" — a first grade is a landing, not a move.
test("tierDelta treats first-grade and no-op as null", () => {
  assert.equal(tierDelta(null, "achieved"), null);
  assert.equal(tierDelta("achieved", null), null);
  assert.equal(tierDelta("achieved", "achieved"), null);
});

// G2.3: undefined (never observed / mid-hydration) is distinct from
// null (a genuine first-read) — both stay null for the DIFF, but the
// distinction matters to callers deciding whether a landing happened.
test("tierDelta treats undefined (unobserved) as null without throwing", () => {
  assert.equal(tierDelta(undefined, "achieved"), null);
});

test("tierDelta returns null for unknown tier ids instead of throwing", () => {
  assert.equal(tierDelta("gold_star", "achieved"), null);
  assert.equal(tierDelta("achieved", "platinum"), null);
});
