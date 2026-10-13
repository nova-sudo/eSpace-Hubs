import test from "node:test";
import assert from "node:assert/strict";

import { deriveCadenceTiers } from "./cadence-tiers.js";

const T = {
  notAchieved: "Current period incomplete",
  achieved: "Current period complete",
  overAchieved: ">= 2 consecutive complete periods",
  roleModel: "Every period complete",
};

test("RECURRING_MILESTONE and COMPOSED get the one-period ladder", () => {
  const expected = {
    notAchieved: "This period's checklist incomplete",
    achieved: "This period's checklist fully complete",
    overAchieved: "Complete with evidence or notes beyond the ask this period",
    roleModel: "Complete, linked and ahead of schedule this period",
  };
  assert.deepEqual(deriveCadenceTiers("RECURRING_MILESTONE", T), expected);
  assert.deepEqual(deriveCadenceTiers("COMPOSED", T), expected);
});

test("other widgets and missing tiers yield null", () => {
  assert.equal(deriveCadenceTiers("MERGED_COUNT", T), null);
  assert.equal(deriveCadenceTiers("RECURRING_MILESTONE", null), null);
});
