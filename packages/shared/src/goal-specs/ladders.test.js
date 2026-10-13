import test from "node:test";
import assert from "node:assert/strict";

import { resolveLadders } from "./ladders.js";

const T = { notAchieved: "n", achieved: "a", overAchieved: "o", roleModel: "r" };
const C = { notAchieved: "cn", achieved: "ca", overAchieved: "co", roleModel: "cr" };
const P = { notAchieved: "pn", achieved: "pa", overAchieved: "po", roleModel: "pr" };

test("cadence falls back to tiers and says so", () => {
  const r = resolveLadders({ tiers: T, cadenceTiers: null }, null);
  assert.deepEqual(r, { final: T, cadence: T, cadenceFallback: true, finalGoverned: false, cadenceGoverned: false });
});

test("spec cadenceTiers used when present", () => {
  const r = resolveLadders({ tiers: T, cadenceTiers: C }, null);
  assert.equal(r.cadence, C);
  assert.equal(r.cadenceFallback, false);
});

test("policy ladders outrank spec ladders independently", () => {
  const r = resolveLadders({ tiers: T, cadenceTiers: C }, { finalTiers: P });
  assert.equal(r.final, P);
  assert.equal(r.finalGoverned, true);
  assert.equal(r.cadence, C);
  assert.equal(r.cadenceGoverned, false);
  const r2 = resolveLadders({ tiers: T }, { cadenceTiers: P });
  assert.equal(r2.cadence, P);
  assert.equal(r2.cadenceGoverned, true);
  assert.equal(r2.cadenceFallback, false);
  assert.equal(r2.final, T);
});

test("no ladders anywhere yields nulls", () => {
  const r = resolveLadders({}, null);
  assert.deepEqual(r, { final: null, cadence: null, cadenceFallback: false, finalGoverned: false, cadenceGoverned: false });
});
