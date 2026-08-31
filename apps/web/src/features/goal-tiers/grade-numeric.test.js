import test from "node:test";
import assert from "node:assert/strict";

import { gradeNumericTier, numericReadingFor } from "./grade-numeric.js";
import { SPEC_KINDS } from "@/features/goal-specs";

const SCALE = {
  direction: "higher",
  achieved: 30,
  overAchieved: 45,
  roleModel: 60,
  unit: "merged PRs",
};

test("gradeNumericTier ranks against thresholds in both directions", () => {
  assert.equal(gradeNumericTier(29, SCALE).tier, "not_achieved");
  assert.equal(gradeNumericTier(30, SCALE).tier, "achieved");
  assert.equal(gradeNumericTier(45, SCALE).tier, "over_achieved");
  assert.equal(gradeNumericTier(61, SCALE).tier, "role_model");

  const lower = { direction: "lower", achieved: 5, unit: "days" };
  assert.equal(gradeNumericTier(4, lower).tier, "achieved");
  assert.equal(gradeNumericTier(6, lower).tier, "not_achieved");
});

// The frozen-tier regression: AUTO readings always carry a numeric
// weekContribution (0 included), so with weekContribution first the
// cumulative was NEVER reached — a dev with 41 merged this quarter but 2
// this week graded "not achieved" against a ≥30 target. Cumulative wins.
test("numericReadingFor prefers the window cumulative over this week's contribution", () => {
  const spec = {
    widget: SPEC_KINDS.MERGED_COUNT,
    source: { metric: "merged_count" },
  };
  const reading = { weekContribution: 2, cumulative: 41 };

  const got = numericReadingFor(spec, [], reading);
  assert.equal(got.value, 41);
  assert.equal(gradeNumericTier(got.value, SCALE).tier, "achieved");
});

test("numericReadingFor still falls back when cumulative is absent", () => {
  const spec = {
    widget: SPEC_KINDS.MERGED_COUNT,
    source: { metric: "merged_count" },
  };
  assert.equal(
    numericReadingFor(spec, [], { weekContribution: 7 }).value,
    7,
  );
  assert.equal(numericReadingFor(spec, [], { value: 3 }).value, 3);
  assert.equal(numericReadingFor(spec, [], {}), null);
  assert.equal(numericReadingFor(spec, [], null), null);
});

test("numericReadingFor manual kinds are unaffected", () => {
  const counter = { widget: SPEC_KINDS.COUNTER, manual: { unit: "docs" } };
  assert.deepEqual(
    numericReadingFor(counter, [{ value: 2 }, { value: 3 }], null),
    { value: 5, unit: "docs" },
  );
});
