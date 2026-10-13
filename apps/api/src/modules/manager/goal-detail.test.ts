import test from "node:test";
import assert from "node:assert/strict";

import { projectSpec } from "./goal-detail.js";

const FINAL = {
  notAchieved: "f-na",
  achieved: "f-a",
  overAchieved: "f-oa",
  roleModel: "f-rm",
};
const CADENCE = {
  notAchieved: "c-na",
  achieved: "c-a",
  overAchieved: "c-oa",
  roleModel: "c-rm",
};

test("only tiers: cadenceTiers mirrors tiers and flags fallback", () => {
  const p = projectSpec({ widget: "COUNTER", tiers: FINAL });
  assert.ok(p?.tiers);
  assert.equal(p.tiers[1]?.criterion, "f-a");
  assert.deepEqual(p.cadenceTiers, p.tiers);
  assert.equal(p.cadenceFallback, true);
});

test("both ladders: distinct projections, no fallback", () => {
  const p = projectSpec({ widget: "COUNTER", tiers: FINAL, cadenceTiers: CADENCE });
  assert.equal(p?.tiers?.[1]?.criterion, "f-a");
  assert.equal(p?.cadenceTiers?.[1]?.criterion, "c-a");
  assert.equal(p?.cadenceFallback, false);
});

test("neither ladder: both null, no fallback", () => {
  const p = projectSpec({ widget: "COUNTER" });
  assert.equal(p?.tiers, null);
  assert.equal(p?.cadenceTiers, null);
  assert.equal(p?.cadenceFallback, false);
});
